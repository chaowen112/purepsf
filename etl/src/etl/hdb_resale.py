"""HDB resale flat prices (data.gov.sg) → projects + transactions.

Data source: data.gov.sg resource d_8b84c4ee58e3cfc0ece0d773c8ca6abc
Fields: month (YYYY-MM), town, flat_type, block, street_name,
        storey_range, floor_area_sqm, flat_model, lease_commence_date,
        remaining_lease, resale_price

Projects are keyed by "BLOCK|STREET_NAME"; lat/lng are populated
separately via `purepsf-etl geocode-missing`.
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
_RESOURCE_ID = "d_8b84c4ee58e3cfc0ece0d773c8ca6abc"
_PAGE_SIZE = 5000
_COMMIT_EVERY = 10_000


def run(limit: int | None = None) -> None:
    cfg = config.load()
    with connect(cfg.database_url) as conn:
        total_fetched = 0
        offset = 0
        transaction_count = skipped = 0

        while True:
            page_limit = _PAGE_SIZE if limit is None else min(_PAGE_SIZE, limit - total_fetched)
            records = _fetch_page(offset, page_limit)
            if not records:
                break

            for rec in records:
                p_id = _upsert_project(conn, rec)
                if p_id is None:
                    skipped += 1
                    continue
                if _upsert_transaction(conn, p_id, rec):
                    transaction_count += 1
                else:
                    skipped += 1

            total_fetched += len(records)

            if total_fetched % _COMMIT_EVERY < _PAGE_SIZE:
                conn.commit()
                logger.info(
                    "HDB progress: fetched=%d transactions=%d skipped=%d",
                    total_fetched, transaction_count, skipped,
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
            total_fetched, project_count, transaction_count, skipped,
        )


def _fetch_page(offset: int, limit: int) -> list[dict[str, Any]]:
    resp = httpx.get(
        _HDB_URL,
        params={"resource_id": _RESOURCE_ID, "limit": limit, "offset": offset},
        timeout=60,
    )
    resp.raise_for_status()
    result = resp.json().get("result", {})
    if offset == 0:
        logger.info("HDB resale dataset total rows: %s", result.get("total", "?"))
    return result.get("records", [])


def _project_key(block: str, street: str) -> str:
    return f"{block.strip().upper()}|{street.strip().upper()}"


def _upsert_project(conn: psycopg.Connection, rec: dict[str, Any]) -> int | None:
    block = (rec.get("block") or "").strip().upper()
    street = (rec.get("street_name") or "").strip().upper()
    if not block or not street:
        return None

    key = _project_key(block, street)
    name = f"BLK {block} {street}"

    row = conn.execute(
        """
        INSERT INTO projects (source, project_key, name, street, district, market_segment, property_type)
        VALUES ('HDB', %s, %s, %s, NULL, NULL, 'HDB Flat')
        ON CONFLICT (source, project_key) DO UPDATE SET
            name = EXCLUDED.name,
            street = EXCLUDED.street
        RETURNING id
        """,
        (key, name, street),
    ).fetchone()
    return row["id"] if row else None


def _upsert_transaction(conn: psycopg.Connection, project_id: int, rec: dict[str, Any]) -> bool:
    month = rec.get("month") or ""  # "YYYY-MM"
    price_raw = rec.get("resale_price")
    area_raw = rec.get("floor_area_sqm")
    if not month or price_raw is None or area_raw is None:
        return False

    try:
        year, mon = int(month[:4]), int(month[5:7])
        contract_date = date(year, mon, 1)
        price = Decimal(str(price_raw))
        area_sqm = Decimal(str(area_raw))
    except (ValueError, InvalidOperation):
        return False

    block = (rec.get("block") or "").strip().upper()
    street = (rec.get("street_name") or "").strip().upper()
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

    cur = conn.execute(
        """
        INSERT INTO transactions (
            project_id, source, contract_date, area_sqm, price,
            floor_range, flat_type, lease_commence_year,
            type_of_sale, dedup_key
        )
        VALUES (%s, 'HDB', %s, %s, %s, %s, %s, %s, 'Resale', %s)
        ON CONFLICT (dedup_key) DO NOTHING
        """,
        (
            project_id, contract_date, area_sqm, price,
            storey_range, flat_type, lease_commence_year, dedup_key,
        ),
    )
    return cur.rowcount > 0
