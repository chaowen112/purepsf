"""SVY21 (EPSG:3414) ↔ WGS84 (EPSG:4326).

URA's PMI_Resi_Transaction returns x/y in SVY21 (Singapore's national projection).
We need WGS84 lng/lat for MapLibre + PostGIS standard usage.
"""
from __future__ import annotations

from functools import lru_cache

from pyproj import Transformer


@lru_cache(maxsize=1)
def _svy21_to_wgs84() -> Transformer:
    # always_xy=True → input (x, y), output (lng, lat). Without it pyproj follows CRS axis order.
    return Transformer.from_crs("EPSG:3414", "EPSG:4326", always_xy=True)


def svy21_to_wgs84(x: float, y: float) -> tuple[float, float]:
    """Return (lng, lat)."""
    lng, lat = _svy21_to_wgs84().transform(x, y)
    return lng, lat
