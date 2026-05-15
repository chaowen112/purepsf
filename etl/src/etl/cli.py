"""Top-level CLI: `purepsf-etl <subcommand>`."""
from __future__ import annotations

import logging

import click

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


@click.group()
def main() -> None:
    """purePSF ETL commands."""


@main.command("ura-transactions")
@click.option("--batches", default="1,2,3,4", help="Comma-separated batch numbers to fetch")
def cmd_ura_transactions(batches: str) -> None:
    """Pull URA private residential transactions and upsert."""
    from etl.ura_transactions import run

    run(batches=[int(b) for b in batches.split(",")])


@main.command("hdb-resale")
@click.option("--limit", default=None, type=int, help="Max rows (default: all)")
def cmd_hdb_resale(limit: int | None) -> None:
    """Pull HDB resale flat prices from data.gov.sg and upsert."""
    from etl.hdb_resale import run

    run(limit=limit)


@main.command("developer-sales")
@click.option("--file", "path", required=True, type=click.Path(exists=True))
def cmd_developer_sales(path: str) -> None:
    """Parse a manually-downloaded URA developer sales Excel and upsert."""
    from etl.ura_developer_sales import run

    run(path=path)


@main.command("geocode-missing")
def cmd_geocode_missing() -> None:
    """Geocode any projects missing lat/lng via OneMap (HDB only in practice)."""
    from etl.geocode import run

    run()


@main.command("backfill-postal")
def cmd_backfill_postal() -> None:
    """Populate projects.postal_code from cached OneMap responses (no network calls)."""
    from etl.geocode import backfill_postal_codes

    backfill_postal_codes()


@main.command("planning-subzones")
@click.option("--file", "path", required=True, type=click.Path(exists=True),
              help="Path to URA MP19 Subzone Boundary GeoJSON")
def cmd_planning_subzones(path: str) -> None:
    """Load URA Master Plan 2019 subzone polygons from a GeoJSON file."""
    from etl.planning_subzones import run

    run(path=path)


if __name__ == "__main__":
    main()
