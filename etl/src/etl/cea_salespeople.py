"""Ingest the CEA salesperson registry from data.gov.sg.

Resource: d_07c63be0f37e6e59c07a4ddc2fd87fcb (~37k rows, monthly refresh).
Upsert keyed on registration_no — same person stays one row across re-runs.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Any

import httpx
import psycopg

from etl import config
from etl.db import connect

logger = logging.getLogger(__name__)

_RESOURCE_ID = "d_07c63be0f37e6e59c07a4ddc2fd87fcb"
_URL = "https://data.gov.sg/api/action/datastore_search"
_PAGE_SIZE = 10_000
_COMMIT_EVERY = 5_000


def _parse_iso_date(v: str | None) -> date | None:
    if not v or v == "-":
        return None
    try:
        return date.fromisoformat(v)
    except ValueError:
        return None


def _norm(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    return v if v and v != "-" else None


def _upsert(conn: psycopg.Connection, rec: dict[str, Any]) -> bool:
    reg = _norm(rec.get("registration_no"))
    name = _norm(rec.get("salesperson_name"))
    if not reg or not name:
        return False
    cur = conn.execute(
        """
        INSERT INTO salespeople (
            registration_no, salesperson_name,
            estate_agent_name, estate_agent_license_no,
            registration_start_date, registration_end_date, updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (registration_no) DO UPDATE SET
            salesperson_name        = EXCLUDED.salesperson_name,
            estate_agent_name       = EXCLUDED.estate_agent_name,
            estate_agent_license_no = EXCLUDED.estate_agent_license_no,
            registration_start_date = EXCLUDED.registration_start_date,
            registration_end_date   = EXCLUDED.registration_end_date,
            updated_at              = NOW()
        """,
        (
            reg, name,
            _norm(rec.get("estate_agent_name")),
            _norm(rec.get("estate_agent_license_no")),
            _parse_iso_date(rec.get("registration_start_date")),
            _parse_iso_date(rec.get("registration_end_date")),
        ),
    )
    return cur.rowcount > 0


def run(limit: int | None = None) -> None:
    cfg = config.load()
    offset = 0
    total_seen = 0
    written = 0

    with connect(cfg.database_url) as conn, httpx.Client(timeout=60) as http:
        while True:
            page_limit = _PAGE_SIZE if limit is None else min(_PAGE_SIZE, limit - total_seen)
            if page_limit <= 0:
                break
            resp = http.get(_URL, params={
                "resource_id": _RESOURCE_ID,
                "limit": page_limit,
                "offset": offset,
            })
            resp.raise_for_status()
            records = (resp.json().get("result") or {}).get("records") or []
            if not records:
                break

            for rec in records:
                if _upsert(conn, rec):
                    written += 1
                if (total_seen + 1) % _COMMIT_EVERY == 0:
                    conn.commit()
                total_seen += 1

            conn.commit()
            offset += len(records)
            logger.info("cea-salespeople: total_seen=%d written=%d", total_seen, written)

            if len(records) < page_limit:
                break

    logger.info("cea-salespeople done: total_seen=%d written=%d", total_seen, written)
