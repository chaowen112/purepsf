"""OneMap geocoding for HDB block + street → lat/lng.

Strategy:
  1. Check geocode_cache table (keyed by "BLOCK|STREET").
  2. If miss, call OneMap /elastic/search, match BLK_NO == block.
  3. Store result in geocode_cache; update projects.lat/lng.

Token is cached to disk (~/.cache/purepsf/onemap_token.json) and refreshed
automatically when within 5 minutes of expiry.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import psycopg
from tenacity import retry, stop_after_attempt, wait_exponential

from etl import config
from etl.db import connect

logger = logging.getLogger(__name__)

TOKEN_CACHE = Path.home() / ".cache" / "purepsf" / "onemap_token.json"


@dataclass
class OneMapClient:
    email: str
    password: str
    token_url: str = "https://www.onemap.gov.sg/api/auth/post/getToken"
    search_url: str = "https://www.onemap.gov.sg/api/common/elastic/search"
    _token: str | None = None
    _token_expiry: float = 0.0

    def __post_init__(self) -> None:
        cached = _load_cached_token()
        if cached:
            self._token, self._token_expiry = cached

    def _ensure_token(self) -> str:
        if self._token and time.time() < self._token_expiry - 300:
            return self._token
        logger.info("requesting new OneMap token")
        resp = httpx.post(
            self.token_url,
            json={"email": self.email, "password": self.password},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        self._token = data["access_token"]
        self._token_expiry = float(data["expiry_timestamp"])
        _save_cached_token(self._token, self._token_expiry)
        return self._token

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=15))
    def search(self, query: str) -> list[dict[str, Any]]:
        token = self._ensure_token()
        resp = httpx.get(
            self.search_url,
            params={"searchVal": query, "returnGeom": "Y", "getAddrDetails": "Y", "pageNum": 1},
            headers={"Authorization": token},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json().get("results") or []


def _load_cached_token() -> tuple[str, float] | None:
    if not TOKEN_CACHE.exists():
        return None
    try:
        data = json.loads(TOKEN_CACHE.read_text())
        return data["token"], float(data["expiry"])
    except (KeyError, ValueError, OSError):
        return None


def _save_cached_token(token: str, expiry: float) -> None:
    TOKEN_CACHE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_CACHE.write_text(json.dumps({"token": token, "expiry": expiry}))


def _cache_key(block: str, street: str) -> str:
    return f"{block.strip().upper()}|{street.strip().upper()}"


@dataclass
class GeocodeHit:
    lat: float
    lng: float
    postal_code: str | None


def _extract_hit(results: list[dict[str, Any]], block: str) -> GeocodeHit | None:
    """Pick the best OneMap result for a block; return None on failure."""
    if not results:
        return None
    block_upper = block.strip().upper()
    match = next(
        (r for r in results if r.get("BLK_NO", "").upper() == block_upper),
        results[0],
    )
    try:
        lat = float(match["LATITUDE"])
        # OneMap has a typo in some responses: LONGTITUDE
        lng = float(match.get("LONGITUDE") or match.get("LONGTITUDE") or "")
    except (KeyError, ValueError, TypeError):
        return None
    postal = match.get("POSTAL") or None
    # OneMap returns the literal string "NIL" when the postal code is unknown.
    if postal in ("NIL", "", None):
        postal = None
    return GeocodeHit(lat=lat, lng=lng, postal_code=postal)


def geocode_hdb_block(
    conn: psycopg.Connection,
    client: OneMapClient,
    block: str,
    street: str,
) -> GeocodeHit | None:
    """Return GeocodeHit for an HDB block+street, caching results in geocode_cache.

    Returns None if geocoding fails (also cached to skip on re-run).
    """
    key = _cache_key(block, street)

    row = conn.execute(
        "SELECT lat, lng, onemap_response, confidence FROM geocode_cache WHERE query_string = %s",
        (key,),
    ).fetchone()
    if row is not None:
        if row["confidence"] == "failed":
            return None
        cached_hit = _extract_hit(row["onemap_response"] or [], block)
        if cached_hit is not None:
            return cached_hit
        # Fallback: response cached but parser changed — reuse lat/lng without postal.
        return GeocodeHit(lat=float(row["lat"]), lng=float(row["lng"]), postal_code=None)

    results = client.search(f"{block} {street}")
    hit = _extract_hit(results, block)
    confidence = "failed" if hit is None else (
        "onemap" if any(r.get("BLK_NO", "").upper() == block.strip().upper() for r in results) else "onemap_approx"
    )

    conn.execute(
        """
        INSERT INTO geocode_cache (query_string, lat, lng, onemap_response, source, confidence, geocoded_at)
        VALUES (%s, %s, %s, %s, 'onemap', %s, NOW())
        ON CONFLICT (query_string) DO NOTHING
        """,
        (key, hit.lat if hit else None, hit.lng if hit else None, json.dumps(results), confidence),
    )

    if hit is None:
        logger.warning("geocode failed: %s", key)
    return hit


def run() -> None:
    """Geocode all HDB projects that are missing lat/lng."""
    cfg = config.load()
    client = OneMapClient(email=cfg.onemap_email, password=cfg.onemap_password)

    with connect(cfg.database_url) as conn:
        projects = conn.execute(
            "SELECT id, project_key FROM projects WHERE source = 'HDB' AND lat IS NULL ORDER BY id"
        ).fetchall()
        logger.info("geocoding %d HDB projects missing coordinates", len(projects))

        succeeded = failed = 0
        total = len(projects)
        for i, proj in enumerate(projects):
            parts = proj["project_key"].split("|", 1)
            if len(parts) != 2:
                failed += 1
                conn.commit()
                continue
            block, street = parts

            hit = geocode_hdb_block(conn, client, block, street)
            if hit:
                conn.execute(
                    "UPDATE projects SET lat = %s, lng = %s, postal_code = COALESCE(%s, postal_code) WHERE id = %s",
                    (hit.lat, hit.lng, hit.postal_code, proj["id"]),
                )
                succeeded += 1
            else:
                failed += 1

            # Commit every record so a crash loses at most one entry.
            conn.commit()

            if (i + 1) % 200 == 0:
                logger.info("geocode progress: %d/%d ok=%d fail=%d", i + 1, total, succeeded, failed)

        logger.info("geocoding done: succeeded=%d failed=%d", succeeded, failed)


def backfill_postal_codes() -> None:
    """Set projects.postal_code for HDB rows from cached OneMap responses.

    No network calls — only re-parses geocode_cache.onemap_response. Safe to run
    repeatedly; only updates rows where postal_code is currently NULL.
    """
    cfg = config.load()
    with connect(cfg.database_url) as conn:
        rows = conn.execute(
            """
            SELECT p.id, p.project_key, g.onemap_response
            FROM projects p
            JOIN geocode_cache g ON g.query_string = p.project_key
            WHERE p.source = 'HDB'
              AND p.postal_code IS NULL
              AND g.confidence <> 'failed'
              AND g.onemap_response IS NOT NULL
            ORDER BY p.id
            """
        ).fetchall()
        logger.info("postal backfill candidates: %d", len(rows))

        updated = skipped = 0
        for r in rows:
            block = r["project_key"].split("|", 1)[0]
            hit = _extract_hit(r["onemap_response"] or [], block)
            if hit is None or hit.postal_code is None:
                skipped += 1
                continue
            conn.execute(
                "UPDATE projects SET postal_code = %s WHERE id = %s AND postal_code IS NULL",
                (hit.postal_code, r["id"]),
            )
            updated += 1
            if updated % 500 == 0:
                conn.commit()
                logger.info("postal backfill progress: updated=%d skipped=%d", updated, skipped)
        conn.commit()
        logger.info("postal backfill done: updated=%d skipped=%d", updated, skipped)
