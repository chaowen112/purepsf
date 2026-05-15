"""Unit tests for planning_subzones parsing helpers."""
from etl.planning_subzones import _parse_description, _props


# Real shape of MP19 properties.Description (trimmed but structurally identical).
MP19_DESCRIPTION_HTML = """
<center><table>
  <tr><th colspan="2">Attributes</th></tr>
  <tr bgcolor="#E7E7E7"><th>SUBZONE_N</th><td>BISHAN EAST</td></tr>
  <tr><th>SUBZONE_C</th><td>BSSZ01</td></tr>
  <tr bgcolor="#E7E7E7"><th>PLN_AREA_N</th><td>BISHAN</td></tr>
  <tr><th>REGION_N</th><td>CENTRAL REGION</td></tr>
</table></center>
"""


def test_parse_description_extracts_named_fields() -> None:
    got = _parse_description(MP19_DESCRIPTION_HTML)
    assert got["SUBZONE_N"] == "BISHAN EAST"
    assert got["SUBZONE_C"] == "BSSZ01"
    assert got["PLN_AREA_N"] == "BISHAN"
    assert got["REGION_N"] == "CENTRAL REGION"


def test_props_merges_html_table_and_real_properties() -> None:
    feature = {
        "properties": {
            "Name": "kml_3",  # MP19 sets Name to a synthetic id; ignore-friendly
            "Description": MP19_DESCRIPTION_HTML,
        }
    }
    props = _props(feature)
    assert props["SUBZONE_N"] == "BISHAN EAST"
    assert props["PLN_AREA_N"] == "BISHAN"


def test_props_falls_back_to_plain_geojson_properties() -> None:
    # Some publishers strip the HTML and provide real GeoJSON properties.
    feature = {
        "properties": {
            "subzone_n": "ANG MO KIO CENTRAL",
            "pln_area_n": "ANG MO KIO",
            "region_n": "NORTH-EAST REGION",
        }
    }
    props = _props(feature)
    assert props["SUBZONE_N"] == "ANG MO KIO CENTRAL"
    assert props["PLN_AREA_N"] == "ANG MO KIO"
    assert props["REGION_N"] == "NORTH-EAST REGION"
