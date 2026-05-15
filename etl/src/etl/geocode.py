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

from etl import config
from etl.db import connect

logger = logging.getLogger(__name__)

TOKEN_CACHE = Path.home() / ".cache" / "purepsf" / "onemap_token.json"
_COMMIT_EVERY = 200


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


def geocode_hdb_block(
    conn: psycopg.Connection,
    client: OneMapClient,
    block: str,
    street: str,
) -> tuple[float, float] | None:
    """Return (lat, lng) for an HDB block+street, caching results in geocode_cache.

    Returns None if geocoding fails (also cached to skip on re-run).
    """
    key = _cache_key(block, street)

    row = conn.execute(
        "SELECT lat, lng, confidence FROM geocode_cache WHERE query_string = %s", (key,)
    ).fetchone()
    if row is not None:
        if row["confidence"] == "failed":
            return None
        return float(row["lat"]), float(row["lng"])

    results = client.search(f"{block} {street}")

    lat = lng = None
    confidence = "failed"

    if results:
        block_upper = block.strip().upper()
        match = next(
            (r for r in results if r.get("BLK_NO", "").upper() == block_upper),
            results[0],
        )
        try:
            lat = float(match["LATITUDE"])
            # OneMap has a typo in some responses: LONGTITUDE
            lng = float(match.get("LONGITUDE") or match.get("LONGTITUDE") or "")
            confidence = "onemap" if match.get("BLK_NO", "").upper() == block_upper else "onemap_approx"
        except (KeyError, ValueError, TypeError):
            pass

    conn.execute(
        """
        INSERT INTO geocode_cache (query_string, lat, lng, onemap_response, source, confidence, geocoded_at)
        VALUES (%s, %s, %s, %s, 'onemap', %s, NOW())
        ON CONFLICT (query_string) DO NOTHING
        """,
        (key, lat, lng, json.dumps(results), confidence),
    )

    if lat is None:
        logger.warning("geocode failed: %s", key)
        return None
    return lat, lng


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
        for i, proj in enumerate(projects):
            parts = proj["project_key"].split("|", 1)
            if len(parts) != 2:
                failed += 1
                continue
            block, street = parts

            result = geocode_hdb_block(conn, client, block, street)
            if result:
                lat, lng = result
                conn.execute(
                    "UPDATE projects SET lat = %s, lng = %s WHERE id = %s",
                    (lat, lng, proj["id"]),
                )
                succeeded += 1
            else:
                failed += 1

            if (i + 1) % _COMMIT_EVERY == 0:
                conn.commit()
                logger.info(
                    "geocode progress: %d/%d ok=%d fail=%d",
                    i + 1, len(projects), succeeded, failed,
                )

            time.sleep(0.5)

        logger.info("geocoding done: succeeded=%d failed=%d", succeeded, failed)
