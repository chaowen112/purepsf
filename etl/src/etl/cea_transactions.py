"""Ingest CEA salesperson transaction records from data.gov.sg.

Resource: d_ee7e46d3c57f7865790704632b0aef71 (~1.3M rows, monthly refresh).

Strategy: stream data.gov.sg's official bulk CSV into a staging
table, then replace the live table in one transaction. A download or parse
failure therefore leaves the previous complete snapshot available to the API.
"""
from __future__ import annotations

import csv
import logging
from collections.abc import Iterable
from datetime import date, datetime
from typing import Any

import httpx
import psycopg

from etl import config
from etl.db import connect

logger = logging.getLogger(__name__)

_RESOURCE_ID = "d_ee7e46d3c57f7865790704632b0aef71"
_DOWNLOAD_URL = (
    "https://api-open.data.gov.sg/v1/public/api/datasets/"
    f"{_RESOURCE_ID}/poll-download"
)
_COMMIT_BATCH = 50_000
_STAGING_TABLE = "salesperson_transactions_next"
_PREVIOUS_TABLE = "salesperson_transactions_previous"


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


def _get_download_url(http: httpx.Client) -> str:
    resp = http.get(_DOWNLOAD_URL)
    resp.raise_for_status()
    data = resp.json().get("data") or {}
    if data.get("status") != "DOWNLOAD_SUCCESS" or not data.get("url"):
        raise RuntimeError(f"CEA bulk download unavailable: status={data.get('status')!r}")
    return str(data["url"])


def _copy_batch(conn: psycopg.Connection, rows: Iterable[tuple]) -> int:
    """COPY one batch + commit. Returns number of rows written."""
    n = 0
    with conn.cursor() as cur, cur.copy(
        f"COPY {_STAGING_TABLE} ("
        "salesperson_reg_num, salesperson_name, transaction_date, "
        "property_type, transaction_type, represented, town, district, general_location"
        ") FROM STDIN"
    ) as copy:
        for row in rows:
            copy.write_row(row)
            n += 1
    conn.commit()
    return n


def _prepare_staging(conn: psycopg.Connection) -> None:
    conn.execute(f"DROP TABLE IF EXISTS {_STAGING_TABLE}")
    conn.execute(
        f"CREATE TABLE {_STAGING_TABLE} "
        "(LIKE salesperson_transactions INCLUDING DEFAULTS INCLUDING CONSTRAINTS)"
    )
    conn.commit()


def _index_staging(conn: psycopg.Connection) -> None:
    conn.execute(
        f"ALTER TABLE {_STAGING_TABLE} "
        f"ADD CONSTRAINT {_STAGING_TABLE}_pkey PRIMARY KEY (id)"
    )
    for suffix, columns in (
        ("reg", "salesperson_reg_num"),
        ("town", "town"),
        ("date", "transaction_date"),
        ("ptype", "property_type"),
        ("rep", "represented"),
        ("filter", "town, property_type, represented"),
    ):
        conn.execute(
            f"CREATE INDEX idx_sp_txn_next_{suffix} "
            f"ON {_STAGING_TABLE} ({columns})"
        )
    conn.commit()


def _swap_staging(conn: psycopg.Connection) -> None:
    """Atomically publish the staged snapshot without copying it again."""
    conn.execute("LOCK TABLE salesperson_transactions IN ACCESS EXCLUSIVE MODE")
    conn.execute(f"DROP TABLE IF EXISTS {_PREVIOUS_TABLE}")
    # BIGSERIAL's sequence starts owned by the live table. Transfer ownership
    # before dropping that table so the staged table keeps a valid default.
    conn.execute(
        "ALTER SEQUENCE salesperson_transactions_id_seq "
        f"OWNED BY {_STAGING_TABLE}.id"
    )
    conn.execute(
        f"ALTER TABLE salesperson_transactions RENAME TO {_PREVIOUS_TABLE}"
    )
    conn.execute(
        f"ALTER TABLE {_STAGING_TABLE} RENAME TO salesperson_transactions"
    )
    conn.execute(f"DROP TABLE {_PREVIOUS_TABLE}")
    conn.execute(
        "ALTER TABLE salesperson_transactions "
        f"RENAME CONSTRAINT {_STAGING_TABLE}_pkey TO salesperson_transactions_pkey"
    )
    for suffix, live_name in (
        ("reg", "idx_sp_txn_reg"),
        ("town", "idx_sp_txn_town"),
        ("date", "idx_sp_txn_date"),
        ("ptype", "idx_sp_txn_ptype"),
        ("rep", "idx_sp_txn_rep"),
        ("filter", "idx_sp_txn_filter"),
    ):
        conn.execute(
            f"ALTER INDEX idx_sp_txn_next_{suffix} RENAME TO {live_name}"
        )
    conn.commit()


def run(limit: int | None = None) -> None:
    cfg = config.load()
    total_seen = 0
    written = 0
    pending: list[tuple] = []

    with connect(cfg.database_url) as conn, httpx.Client(
        follow_redirects=True,
        timeout=httpx.Timeout(120),
    ) as http:
        _prepare_staging(conn)
        logger.info("cea-transactions: streaming official bulk CSV into staging")

        download_url = _get_download_url(http)
        httpx_logger = logging.getLogger("httpx")
        previous_httpx_level = httpx_logger.level
        httpx_logger.setLevel(logging.WARNING)
        try:
            with http.stream("GET", download_url) as resp:
                resp.raise_for_status()
                for rec in csv.DictReader(resp.iter_lines()):
                    if limit is not None and total_seen >= limit:
                        break
                    row = _row(rec)
                    if row is not None:
                        pending.append(row)
                    total_seen += 1

                    if len(pending) >= _COMMIT_BATCH:
                        written += _copy_batch(conn, pending)
                        pending.clear()
                        logger.info(
                            "cea-transactions: total_seen=%d staged=%d",
                            total_seen,
                            written,
                        )
        finally:
            httpx_logger.setLevel(previous_httpx_level)

        if pending:
            written += _copy_batch(conn, pending)
            pending.clear()

        if written == 0:
            raise RuntimeError("CEA bulk download produced no valid transaction rows")

        _index_staging(conn)
        _swap_staging(conn)

    logger.info("cea-transactions done: total_seen=%d written=%d", total_seen, written)
