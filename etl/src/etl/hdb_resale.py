"""HDB resale flat prices (data.gov.sg) → projects + transactions.

Default resource: d_8b84c4ee58e3cfc0ece0d773c8ca6abc (Jan 2017 → now).
Pass `resource_id` to ingest any of the archived chunks (1990-on).
Older datasets use Title-Case field names ("Street Name", "Floor Area"),
which _normalize_record() collapses to the snake_case shape this module
already speaks. The `remaining_lease` column doesn't exist on older
datasets — we never read it anyway.

Projects are keyed by "BLOCK|STREET_NAME"; lat/lng are populated
separately via `purepsf-etl geocode-missing`.

Implementation note: this module talks to a remote Postgres across a
VPN. Per-row inserts were latency-bound (~30 rows/sec). We now buffer
each fetched page and write via cursor.executemany (one round-trip per
~5000-row page), which gets ~3000 rows/sec out of the same pipe.
"""
from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx
import psycopg

from etl import config
from etl.db import connect

logger = logging.getLogger(__name__)

_HDB_URL = "https://data.gov.sg/api/action/datastore_search"
_DEFAULT_RESOURCE = "d_8b84c4ee58e3cfc0ece0d773c8ca6abc"
_PAGE_SIZE = 5000


def _normalize_record(rec: dict[str, Any]) -> dict[str, Any]:
    """Coerce Title-Case keys like 'Street Name' to snake_case 'street_name'."""
    return {k.lower().replace(" ", "_"): v for k, v in rec.items()}


def run(limit: int | None = None, resource_id: str = _DEFAULT_RESOURCE) -> None:
    cfg = config.load()
    with connect(cfg.database_url) as conn:
        total_fetched = 0
        total_projects_seen = 0
        total_transactions = 0
        total_skipped = 0
        offset = 0

        while True:
            page_limit = _PAGE_SIZE if limit is None else min(_PAGE_SIZE, limit - total_fetched)
            records = _fetch_page(resource_id, offset, page_limit)
            if not records:
                break

            normalized = [_normalize_record(r) for r in records]

            # Step 1: bulk-upsert all distinct (block, street) pairs from this
            # page, then read back their ids in one round-trip.
            project_ids = _bulk_upsert_projects(conn, normalized)
            total_projects_seen += len(project_ids)

            # Step 2: build per-record transaction tuples, dropping malformed.
            tx_rows: list[tuple] = []
            for rec in normalized:
                row = _build_transaction_row(rec, project_ids)
                if row is not None:
                    tx_rows.append(row)
                else:
                    total_skipped += 1

            if tx_rows:
                inserted = _bulk_insert_transactions(conn, tx_rows)
                total_transactions += inserted
                # Anything not actually inserted is a dedup-key collision.
                total_skipped += len(tx_rows) - inserted

            conn.commit()
            total_fetched += len(records)
            logger.info(
                "HDB progress: fetched=%d transactions=%d skipped=%d",
                total_fetched, total_transactions, total_skipped,
            )

            offset += len(records)
            if limit is not None and total_fetched >= limit:
                break
            if len(records) < page_limit:
                break

        project_count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM projects WHERE source = 'HDB'"
        ).fetchone()["cnt"]
        logger.info(
            "HDB done: fetched=%d projects=%d transactions=%d skipped=%d",
            total_fetched, project_count, total_transactions, total_skipped,
        )


def _fetch_page(resource_id: str, offset: int, limit: int) -> list[dict[str, Any]]:
    resp = httpx.get(
        _HDB_URL,
        params={"resource_id": resource_id, "limit": limit, "offset": offset},
        timeout=60,
    )
    resp.raise_for_status()
    result = resp.json().get("result", {})
    if offset == 0:
        logger.info("HDB resale dataset %s total rows: %s", resource_id, result.get("total", "?"))
    return result.get("records", [])


def _project_key(block: str, street: str) -> str:
    return f"{block.strip().upper()}|{street.strip().upper()}"


def _bulk_upsert_projects(
    conn: psycopg.Connection, records: list[dict[str, Any]]
) -> dict[str, int]:
    """Upsert every distinct (block, street) seen on this page and return
    a {project_key: id} map. One executemany + one SELECT, instead of
    N round-trips."""
    seen: dict[str, tuple[str, str, str]] = {}
    for rec in records:
        block = (rec.get("block") or "").strip().upper()
        street = (rec.get("street_name") or "").strip().upper()
        if not block or not street:
            continue
        key = _project_key(block, street)
        if key not in seen:
            seen[key] = (key, f"BLK {block} {street}", street)

    if not seen:
        return {}

    rows = list(seen.values())
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO projects (source, project_key, name, street, district, market_segment, property_type)
            VALUES ('HDB', %s, %s, %s, NULL, NULL, 'HDB Flat')
            ON CONFLICT (source, project_key) DO UPDATE SET
                name   = EXCLUDED.name,
                street = EXCLUDED.street
            """,
            rows,
        )

    # Read back the ids — single round-trip via ANY(array).
    keys = list(seen.keys())
    cur = conn.execute(
        "SELECT project_key, id FROM projects WHERE source = 'HDB' AND project_key = ANY(%s)",
        (keys,),
    )
    return {r["project_key"]: r["id"] for r in cur.fetchall()}


def _build_transaction_row(
    rec: dict[str, Any], project_ids: dict[str, int]
) -> tuple | None:
    month = rec.get("month") or ""  # "YYYY-MM"
    price_raw = rec.get("resale_price")
    # 2017+: floor_area_sqm; pre-2017 archives: 'Floor Area' → 'floor_area'.
    area_raw = rec.get("floor_area_sqm") or rec.get("floor_area")
    if not month or price_raw is None or area_raw is None:
        return None

    block = (rec.get("block") or "").strip().upper()
    street = (rec.get("street_name") or "").strip().upper()
    if not block or not street:
        return None
    project_id = project_ids.get(_project_key(block, street))
    if project_id is None:
        return None

    try:
        year, mon = int(month[:4]), int(month[5:7])
        contract_date = date(year, mon, 1)
        price = Decimal(str(price_raw))
        area_sqm = Decimal(str(area_raw))
    except (ValueError, InvalidOperation):
        return None

    flat_type = (rec.get("flat_type") or "").strip() or None
    storey_range = (rec.get("storey_range") or "").strip() or None
    lease_commence_year: int | None = None
    if raw := rec.get("lease_commence_date"):
        try:
            lease_commence_year = int(raw)
        except (ValueError, TypeError):
            pass

    dedup_key = "|".join([
        "HDB", block, street, month,
        f"{area_sqm:.2f}", f"{price:.2f}",
        storey_range or "", flat_type or "",
    ])

    return (
        project_id, contract_date, area_sqm, price,
        storey_range, flat_type, lease_commence_year, dedup_key,
    )


def _bulk_insert_transactions(
    conn: psycopg.Connection, rows: list[tuple]
) -> int:
    """Bulk INSERT with ON CONFLICT DO NOTHING, returning the number of new rows."""
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO transactions (
                project_id, source, contract_date, area_sqm, price,
                floor_range, flat_type, lease_commence_year,
                type_of_sale, dedup_key
            )
            VALUES (%s, 'HDB', %s, %s, %s, %s, %s, %s, 'Resale', %s)
            ON CONFLICT (dedup_key) DO NOTHING
            """,
            rows,
        )
        # psycopg3: rowcount is cumulative across all parameter sets.
        return max(cur.rowcount, 0)
