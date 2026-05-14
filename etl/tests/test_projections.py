"""Sanity check that SVY21 → WGS84 places points inside Singapore."""
from __future__ import annotations

from etl.projections import svy21_to_wgs84


def test_origin_marker() -> None:
    # SVY21 origin: 1.36667°N, 103.83333°E (officially at the Bukit Timah survey datum).
    # We do not need exact roundtrip — just that it lands in Singapore.
    x_svy21, y_svy21 = 28001.642, 38744.572  # Raffles Place area
    lng, lat = svy21_to_wgs84(x_svy21, y_svy21)
    assert 103.5 < lng < 104.2, f"lng out of SG range: {lng}"
    assert 1.1 < lat < 1.5, f"lat out of SG range: {lat}"
