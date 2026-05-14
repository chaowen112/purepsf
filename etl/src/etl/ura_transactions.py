"""URA PMI_Resi_Transaction → projects + transactions.

For each batch (1..4):
  1. Fetch JSON list of projects (each with embedded transaction list).
  2. Upsert into `projects` (one row per unique project name in URA's data).
  3. Upsert into `transactions` keyed by a deterministic dedup_key.

URA already returns SVY21 x/y coordinates; we convert once per project.
"""
from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any

import psycopg

from etl import config
from etl.db import connect
from etl.projections import svy21_to_wgs84
from etl.ura_client import URAClient, normalize_type_of_sale, parse_contract_date

logger = logging.getLogger(__name__)


def run(batches: list[int]) -> None:
    cfg = config.load()
    client = URAClient(access_key=cfg.ura_access_key)
    with connect(cfg.database_url) as conn:
        for batch in batches:
            projects = client.fetch_residential_transactions(batch)
            _ingest_batch(conn, projects, batch)


def _ingest_batch(conn: psycopg.Connection, projects: list[dict[str, Any]], batch: int) -> None:
    project_count = 0
    transaction_count = 0
    skipped = 0
    with conn.cursor() as cur:
        for proj in projects:
            project_name = (proj.get("project") or "").strip()
            if not project_name:
                skipped += 1
                continue
            project_id = _upsert_project(cur, proj)
            project_count += 1
            for txn in proj.get("transaction", []):
                if _upsert_transaction(cur, project_id, project_name, txn):
                    transaction_count += 1
                else:
                    skipped += 1
    logger.info(
        "batch=%d ingested: projects=%d transactions=%d skipped=%d",
        batch, project_count, transaction_count, skipped,
    )


def _upsert_project(cur: psycopg.Cursor, proj: dict[str, Any]) -> int:
    name = proj["project"].strip()
    street = (proj.get("street") or "").strip() or None
    market_segment = proj.get("marketSegment") or None  # 'CCR' | 'RCR' | 'OCR'
    district = proj.get("district")
    district_label = f"D{int(district):02d}" if district and str(district).isdigit() else None

    x_raw = proj.get("x")
    y_raw = proj.get("y")
    lat = lng = None
    if x_raw and y_raw:
        try:
            lng, lat = svy21_to_wgs84(float(x_raw), float(y_raw))
        except (TypeError, ValueError):
            pass

    # Coarse property type: take from first transaction if available.
    first_txn = (proj.get("transaction") or [{}])[0]
    property_type = first_txn.get("propertyType") or None

    cur.execute(
        """
        INSERT INTO projects (
            source, project_key, name, street, district, market_segment,
            property_type, lat, lng
        )
        VALUES ('URA', %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (source, project_key) DO UPDATE SET
            name = EXCLUDED.name,
            street = EXCLUDED.street,
            district = COALESCE(EXCLUDED.district, projects.district),
            market_segment = COALESCE(EXCLUDED.market_segment, projects.market_segment),
            property_type = COALESCE(EXCLUDED.property_type, projects.property_type),
            lat = COALESCE(EXCLUDED.lat, projects.lat),
            lng = COALESCE(EXCLUDED.lng, projects.lng)
        RETURNING id
        """,
        (name, name, street, district_label, market_segment, property_type, lat, lng),
    )
    row = cur.fetchone()
    assert row is not None
    return row["id"]


def _upsert_transaction(
    cur: psycopg.Cursor, project_id: int, project_name: str, txn: dict[str, Any]
) -> bool:
    contract_date_raw = txn.get("contractDate")
    price_raw = txn.get("price")
    area_raw = txn.get("area")
    if not contract_date_raw or price_raw is None or area_raw is None:
        return False
    try:
        contract_date = parse_contract_date(str(contract_date_raw))
        price = Decimal(str(price_raw))
        area_sqm = Decimal(str(area_raw))
    except (ValueError, ArithmeticError) as e:
        logger.debug("skip bad txn for %s: %s", project_name, e)
        return False

    tenure = txn.get("tenure") or None
    floor_range = txn.get("floorRange") or None
    property_type = txn.get("propertyType") or None
    type_of_sale = normalize_type_of_sale(txn.get("typeOfSale"))
    no_of_units = _to_int(txn.get("noOfUnits"))

    dedup_key = "|".join(
        [
            "URA",
            project_name,
            contract_date.isoformat(),
            f"{area_sqm:.2f}",
            f"{price:.2f}",
            floor_range or "",
            property_type or "",
            type_of_sale or "",
        ]
    )

    cur.execute(
        """
        INSERT INTO transactions (
            project_id, source, contract_date, area_sqm, price,
            tenure, floor_range, property_type, type_of_sale, no_of_units, dedup_key
        )
        VALUES (%s, 'URA', %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (dedup_key) DO NOTHING
        """,
        (
            project_id, contract_date, area_sqm, price,
            tenure, floor_range, property_type, type_of_sale, no_of_units, dedup_key,
        ),
    )
    return cur.rowcount > 0


def _to_int(v: Any) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None
