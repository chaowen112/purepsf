"""URA monthly developer sales Excel parser.

Implemented in M1c. MVP path: user manually downloads the monthly XLSX from
https://www.ura.gov.sg/Corporate/Property/Property-Data into data/ura_developer_sales/,
then runs `purepsf-etl developer-sales --file data/ura_developer_sales/<file>.xlsx`.
"""
from __future__ import annotations


def run(path: str) -> None:  # pragma: no cover — implemented in M1c
    raise NotImplementedError("see M1c")
