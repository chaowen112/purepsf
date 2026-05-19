"""HDB Property Information (data.gov.sg) -> block metadata + HDB projects.

This official dataset covers HDB blocks even before they have resale
transactions, so it fills the "pre-MOP blank map" gap without pretending that
metadata rows are sale records.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx
import psycopg
from psycopg.types.json import Jsonb

from etl import config
from etl.db import connect

logger = logging.getLogger(__name__)

_URL = "https://data.gov.sg/api/action/datastore_search"
_RESOURCE_ID = "d_17f5382f26140b1fdae0ba2ef6239d2f"
_PAGE_SIZE = 5000


def run(limit: int | None = None) -> None:
    cfg = config.load()
    total_fetched = 0
    total_upserted = 0
    offset = 0

    with connect(cfg.database_url) as conn:
        while True:
            page_limit = _PAGE_SIZE if limit is None else min(_PAGE_SIZE, limit - total_fetched)
            if page_limit <= 0:
                break

            records = _fetch_page(offset=offset, limit=page_limit)
            if not records:
                break

            rows = [_build_row(r) for r in records]
            inserted = _bulk_upsert(conn, rows)
            _bulk_upsert_projects(conn, rows)
            conn.commit()

            total_fetched += len(records)
            total_upserted += inserted
            logger.info(
                "HDB property info progress: fetched=%d upserted=%d",
                total_fetched,
                total_upserted,
            )

            offset += len(records)
            if limit is not None and total_fetched >= limit:
                break
            if len(records) < page_limit:
                break

    logger.info("HDB property info done: fetched=%d upserted=%d", total_fetched, total_upserted)


def _fetch_page(offset: int, limit: int) -> list[dict[str, Any]]:
    resp = httpx.get(
        _URL,
        params={"resource_id": _RESOURCE_ID, "limit": limit, "offset": offset},
        timeout=60,
    )
    resp.raise_for_status()
    result = resp.json().get("result", {})
    if offset == 0:
        logger.info("HDB property info total rows: %s", result.get("total", "?"))
    return result.get("records", [])


def _project_key(block: str, street: str) -> str:
    return f"{block.strip().upper()}|{street.strip().upper()}"


def _int(rec: dict[str, Any], key: str) -> int:
    raw = rec.get(key)
    if raw is None or raw == "":
        return 0
    try:
        return int(str(raw).strip())
    except ValueError:
        return 0


def _opt_int(rec: dict[str, Any], key: str) -> int | None:
    raw = rec.get(key)
    if raw is None or raw == "":
        return None
    try:
        return int(str(raw).strip())
    except ValueError:
        return None


def _bool(rec: dict[str, Any], key: str) -> bool:
    return str(rec.get(key) or "").strip().upper() == "Y"


def _build_row(rec: dict[str, Any]) -> tuple:
    block = str(rec.get("blk_no") or "").strip().upper()
    street = str(rec.get("street") or "").strip().upper()
    return (
        _project_key(block, street),
        block,
        street,
        _opt_int(rec, "max_floor_lvl"),
        _opt_int(rec, "year_completed"),
        _bool(rec, "residential"),
        _bool(rec, "commercial"),
        _bool(rec, "market_hawker"),
        _bool(rec, "miscellaneous"),
        _bool(rec, "multistorey_carpark"),
        _bool(rec, "precinct_pavilion"),
        str(rec.get("bldg_contract_town") or "").strip().upper() or None,
        _int(rec, "total_dwelling_units"),
        _int(rec, "1room_sold"),
        _int(rec, "2room_sold"),
        _int(rec, "3room_sold"),
        _int(rec, "4room_sold"),
        _int(rec, "5room_sold"),
        _int(rec, "exec_sold"),
        _int(rec, "multigen_sold"),
        _int(rec, "studio_apartment_sold"),
        _int(rec, "1room_rental"),
        _int(rec, "2room_rental"),
        _int(rec, "3room_rental"),
        _int(rec, "other_room_rental"),
        Jsonb(rec),
    )


def _bulk_upsert(conn: psycopg.Connection, rows: list[tuple]) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO hdb_property_info (
                project_key, blk_no, street, max_floor_lvl, year_completed,
                residential, commercial, market_hawker, miscellaneous,
                multistorey_carpark, precinct_pavilion, bldg_contract_town,
                total_dwelling_units, one_room_sold, two_room_sold, three_room_sold,
                four_room_sold, five_room_sold, exec_sold, multigen_sold,
                studio_apartment_sold, one_room_rental, two_room_rental,
                three_room_rental, other_room_rental, raw_record
            )
            VALUES (
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s
            )
            ON CONFLICT (project_key) DO UPDATE SET
                blk_no = EXCLUDED.blk_no,
                street = EXCLUDED.street,
                max_floor_lvl = EXCLUDED.max_floor_lvl,
                year_completed = EXCLUDED.year_completed,
                residential = EXCLUDED.residential,
                commercial = EXCLUDED.commercial,
                market_hawker = EXCLUDED.market_hawker,
                miscellaneous = EXCLUDED.miscellaneous,
                multistorey_carpark = EXCLUDED.multistorey_carpark,
                precinct_pavilion = EXCLUDED.precinct_pavilion,
                bldg_contract_town = EXCLUDED.bldg_contract_town,
                total_dwelling_units = EXCLUDED.total_dwelling_units,
                one_room_sold = EXCLUDED.one_room_sold,
                two_room_sold = EXCLUDED.two_room_sold,
                three_room_sold = EXCLUDED.three_room_sold,
                four_room_sold = EXCLUDED.four_room_sold,
                five_room_sold = EXCLUDED.five_room_sold,
                exec_sold = EXCLUDED.exec_sold,
                multigen_sold = EXCLUDED.multigen_sold,
                studio_apartment_sold = EXCLUDED.studio_apartment_sold,
                one_room_rental = EXCLUDED.one_room_rental,
                two_room_rental = EXCLUDED.two_room_rental,
                three_room_rental = EXCLUDED.three_room_rental,
                other_room_rental = EXCLUDED.other_room_rental,
                raw_record = EXCLUDED.raw_record,
                fetched_at = now()
            """,
            rows,
        )
        return max(cur.rowcount, 0)


def _bulk_upsert_projects(conn: psycopg.Connection, rows: list[tuple]) -> None:
    project_rows = [
        (key, f"BLK {block} {street}", street, year_completed)
        for (
            key,
            block,
            street,
            _max_floor,
            year_completed,
            residential,
            *_rest,
        ) in rows
        if block and street and residential
    ]
    if not project_rows:
        return

    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO projects (
                source, project_key, name, street, district, market_segment,
                property_type, tenure_type, lease_commence_year
            )
            VALUES ('HDB', %s, %s, %s, NULL, NULL, 'HDB Flat', '99-year', %s)
            ON CONFLICT (source, project_key) DO UPDATE SET
                name = EXCLUDED.name,
                street = EXCLUDED.street,
                property_type = EXCLUDED.property_type,
                tenure_type = COALESCE(projects.tenure_type, EXCLUDED.tenure_type),
                lease_commence_year = COALESCE(
                    projects.lease_commence_year,
                    EXCLUDED.lease_commence_year
                )
            """,
            project_rows,
        )
