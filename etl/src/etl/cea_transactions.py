"""Ingest CEA salesperson transaction records from data.gov.sg.

Resource: d_ee7e46d3c57f7865790704632b0aef71 (~1.3M rows, monthly refresh).

Strategy: full reload via TRUNCATE + batched COPY. Each batch is its own
short COPY transaction so a network blip on page N doesn't roll back
the previous N-1 pages. The HTTP fetch is wrapped in tenacity retry to
survive transient ReadTimeouts on the data.gov.sg API.
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any, Iterable

import httpx
import psycopg
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from etl import config
from etl.db import connect

logger = logging.getLogger(__name__)

_RESOURCE_ID = "d_ee7e46d3c57f7865790704632b0aef71"
_URL = "https://data.gov.sg/api/action/datastore_search"
_PAGE_SIZE = 10_000
# Rows per COPY transaction. Higher = fewer commits but more re-work on failure.
_COMMIT_BATCH = 50_000


def parse_cea_month(v: str | None) -> date | None:
    """Parse CEA's 'MMM-YYYY' month into a date pinned to the first of the month."""
    if not v or v == "-":
        return None
    try:
        return datetime.strptime(v.strip().upper(), "%b-%Y").date()
    except ValueError:
        return None


def _norm(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    return v if v and v != "-" else None


def _row(rec: dict[str, Any]) -> tuple | None:
    reg = _norm(rec.get("salesperson_reg_num"))
    tx_date = parse_cea_month(rec.get("transaction_date"))
    if not reg or not tx_date:
        return None
    return (
        reg,
        _norm(rec.get("salesperson_name")),
        tx_date,
        _norm(rec.get("property_type")),
        _norm(rec.get("transaction_type")),
        _norm(rec.get("represented")),
        _norm(rec.get("town")),
        _norm(rec.get("district")),
        _norm(rec.get("general_location")),
    )


@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type((httpx.HTTPError, httpx.TimeoutException)),
    reraise=True,
)
def _fetch_page(http: httpx.Client, offset: int, limit: int) -> list[dict[str, Any]]:
    resp = http.get(_URL, params={
        "resource_id": _RESOURCE_ID,
        "limit": limit,
        "offset": offset,
    })
    resp.raise_for_status()
    return (resp.json().get("result") or {}).get("records") or []


def _copy_batch(conn: psycopg.Connection, rows: Iterable[tuple]) -> int:
    """COPY one batch + commit. Returns number of rows written."""
    n = 0
    with conn.cursor() as cur, cur.copy(
        "COPY salesperson_transactions ("
        "salesperson_reg_num, salesperson_name, transaction_date, "
        "property_type, transaction_type, represented, town, district, general_location"
        ") FROM STDIN"
    ) as copy:
        for row in rows:
            copy.write_row(row)
            n += 1
    conn.commit()
    return n


def run(limit: int | None = None) -> None:
    cfg = config.load()
    offset = 0
    total_seen = 0
    written = 0
    pending: list[tuple] = []

    with connect(cfg.database_url) as conn, httpx.Client(timeout=120) as http:
        conn.execute("TRUNCATE salesperson_transactions RESTART IDENTITY")
        conn.commit()
        logger.info("cea-transactions: truncated; beginning load")

        while True:
            page_limit = _PAGE_SIZE if limit is None else min(_PAGE_SIZE, limit - total_seen)
            if page_limit <= 0:
                break
            records = _fetch_page(http, offset, page_limit)
            if not records:
                break

            for rec in records:
                row = _row(rec)
                if row is not None:
                    pending.append(row)
            total_seen += len(records)
            offset += len(records)

            if len(pending) >= _COMMIT_BATCH:
                n = _copy_batch(conn, pending)
                written += n
                pending.clear()
                logger.info("cea-transactions: total_seen=%d written=%d (committed)", total_seen, written)

            if len(records) < page_limit:
                break

        if pending:
            n = _copy_batch(conn, pending)
            written += n
            pending.clear()

    logger.info("cea-transactions done: total_seen=%d written=%d", total_seen, written)
