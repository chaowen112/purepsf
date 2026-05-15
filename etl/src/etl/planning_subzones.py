"""Load URA Master Plan 2019 planning subzone polygons into Postgres.

Source: data.gov.sg → "Master Plan 2019 Subzone Boundary (No Sea)".
Download GeoJSON manually (link rotates) and pass the path:

    purepsf-etl planning-subzones --file data/mp19_subzones.geojson

The MP19 dataset stuffs feature attributes (SUBZONE_N, PLN_AREA_N, REGION_N,
SUBZONE_C) inside the `Description` HTML field as a <table>. We parse them out.
"""
from __future__ import annotations

import json
import logging
import re
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import psycopg

from etl import config
from etl.db import connect

logger = logging.getLogger(__name__)


class _DescriptionTableParser(HTMLParser):
    """Extract <th>Key</th><td>Value</td> pairs from the embedded HTML table.

    The MP19 format has a header row (single <th colspan="2">Attributes</th>)
    followed by data rows of (<th>KEY</th><td>VALUE</td>). We bucket cells by
    <tr> boundary and only treat 2-cell rows as key/value pairs.
    """

    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._current_row: list[str] = []
        self._buf: list[str] = []
        self._capturing = False

    def handle_starttag(self, tag: str, _attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._current_row = []
        elif tag in ("th", "td"):
            self._capturing = True
            self._buf = []

    def handle_endtag(self, tag: str) -> None:
        if tag in ("th", "td") and self._capturing:
            self._current_row.append("".join(self._buf).strip())
            self._capturing = False
        elif tag == "tr":
            if self._current_row:
                self.rows.append(self._current_row)
            self._current_row = []

    def handle_data(self, data: str) -> None:
        if self._capturing:
            self._buf.append(data)


def _parse_description(html: str) -> dict[str, str]:
    """Return {KEY: value} from the embedded MP19 description table."""
    p = _DescriptionTableParser()
    p.feed(html or "")
    out: dict[str, str] = {}
    for row in p.rows:
        if len(row) == 2 and row[0]:
            out[row[0].upper()] = row[1]
    return out


def _props(feature: dict[str, Any]) -> dict[str, str]:
    """Coalesce real GeoJSON properties + the HTML-table inside `Description`."""
    raw = feature.get("properties") or {}
    merged: dict[str, str] = {}
    desc = raw.get("Description") or raw.get("description")
    if isinstance(desc, str) and "<" in desc:
        merged.update(_parse_description(desc))
    for k, v in raw.items():
        if v is None:
            continue
        merged.setdefault(k.upper(), str(v))
    return merged


def _clean(s: str | None) -> str | None:
    if s is None:
        return None
    s = re.sub(r"\s+", " ", s).strip()
    return s or None


def _upsert(conn: psycopg.Connection, feature: dict[str, Any]) -> bool:
    geom = feature.get("geometry")
    if not geom or geom.get("type") not in ("Polygon", "MultiPolygon"):
        return False
    p = _props(feature)
    name = _clean(p.get("SUBZONE_N") or p.get("SUBZONE_NAME") or p.get("NAME"))
    if not name:
        return False
    area = _clean(p.get("PLN_AREA_N") or p.get("PLANNING_AREA"))
    region = _clean(p.get("REGION_N") or p.get("REGION"))
    code = _clean(p.get("SUBZONE_C") or p.get("SUBZONE_CODE"))

    geom_json = json.dumps(geom)
    conn.execute(
        """
        INSERT INTO planning_subzones (subzone_code, subzone_name, planning_area, region, geom)
        VALUES (
            %s, %s, %s, %s,
            ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
        )
        ON CONFLICT (subzone_name, planning_area)
        DO UPDATE SET geom = EXCLUDED.geom, subzone_code = EXCLUDED.subzone_code,
                      region = EXCLUDED.region, loaded_at = now()
        """,
        (code, name, area, region, geom_json),
    )
    return True


def run(path: str) -> None:
    cfg = config.load()
    geojson = json.loads(Path(path).read_text())
    features = geojson.get("features") or []
    logger.info("loading %d subzone features from %s", len(features), path)

    with connect(cfg.database_url) as conn:
        loaded = skipped = 0
        for f in features:
            if _upsert(conn, f):
                loaded += 1
            else:
                skipped += 1
        conn.commit()
    logger.info("subzones: loaded=%d skipped=%d", loaded, skipped)
