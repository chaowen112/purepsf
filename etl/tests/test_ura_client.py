"""Unit tests for URA client parsing — no network."""
from __future__ import annotations

from datetime import date

import pytest

from etl.ura_client import normalize_type_of_sale, parse_contract_date


class TestParseContractDate:
    def test_typical(self) -> None:
        assert parse_contract_date("0524") == date(2024, 5, 1)

    def test_december(self) -> None:
        assert parse_contract_date("1223") == date(2023, 12, 1)

    @pytest.mark.parametrize("bad", ["", "12345", "abcd", "1324"])
    def test_rejects_bad(self, bad: str) -> None:
        with pytest.raises(ValueError):
            parse_contract_date(bad)


class TestNormalizeTypeOfSale:
    @pytest.mark.parametrize(
        "code,expected",
        [("1", "New Sale"), ("2", "Sub Sale"), ("3", "Resale"), ("9", "9"), (None, None)],
    )
    def test_codes(self, code: str | None, expected: str | None) -> None:
        assert normalize_type_of_sale(code) == expected
