"""Unit tests for CEA ETL helpers (no DB / no network)."""
from datetime import date

from etl.cea_salespeople import _norm, _parse_iso_date
from etl.cea_transactions import _row, parse_cea_month


def test_parse_cea_month_handles_uppercase() -> None:
    assert parse_cea_month("OCT-2017") == date(2017, 10, 1)


def test_parse_cea_month_handles_mixed_case() -> None:
    assert parse_cea_month("Jan-2024") == date(2024, 1, 1)


def test_parse_cea_month_returns_none_for_invalid() -> None:
    assert parse_cea_month("") is None
    assert parse_cea_month("-") is None
    assert parse_cea_month(None) is None
    assert parse_cea_month("2017-10") is None


def test_iso_date_strict() -> None:
    assert _parse_iso_date("2011-01-01") == date(2011, 1, 1)
    assert _parse_iso_date("2026-12-31") == date(2026, 12, 31)
    assert _parse_iso_date("") is None
    assert _parse_iso_date("-") is None
    assert _parse_iso_date(None) is None
    assert _parse_iso_date("01/01/2011") is None


def test_norm_collapses_dash_and_blank() -> None:
    assert _norm("YISHUN") == "YISHUN"
    assert _norm(" YISHUN ") == "YISHUN"
    assert _norm("") is None
    assert _norm("-") is None
    assert _norm(None) is None


def test_cea_transaction_csv_row() -> None:
    assert _row(
        {
            "salesperson_name": "EXAMPLE AGENT",
            "transaction_date": "AUG-2026",
            "salesperson_reg_num": "P123456A",
            "property_type": "HDB",
            "transaction_type": "RESALE",
            "represented": "BUYER",
            "town": "YISHUN",
            "district": "-",
            "general_location": "-",
        }
    ) == (
        "P123456A",
        "EXAMPLE AGENT",
        date(2026, 8, 1),
        "HDB",
        "RESALE",
        "BUYER",
        "YISHUN",
        None,
        None,
    )
