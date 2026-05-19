"""Unit tests for HDB Property Information helpers."""

from etl.hdb_property_info import _build_row


def test_build_row_normalizes_block_key_and_counts() -> None:
    row = _build_row({
        "blk_no": " 651C ",
        "street": "Ang Mo Kio Ave 9",
        "max_floor_lvl": "18",
        "year_completed": "2024",
        "residential": "Y",
        "commercial": "N",
        "market_hawker": "N",
        "miscellaneous": "N",
        "multistorey_carpark": "N",
        "precinct_pavilion": "Y",
        "bldg_contract_town": "amk",
        "total_dwelling_units": "152",
        "1room_sold": "0",
        "2room_sold": "34",
        "3room_sold": "34",
        "4room_sold": "84",
        "5room_sold": "0",
        "exec_sold": "0",
        "multigen_sold": "0",
        "studio_apartment_sold": "0",
        "1room_rental": "0",
        "2room_rental": "0",
        "3room_rental": "0",
        "other_room_rental": "0",
    })

    assert row[0] == "651C|ANG MO KIO AVE 9"
    assert row[1] == "651C"
    assert row[2] == "ANG MO KIO AVE 9"
    assert row[3] == 18
    assert row[4] == 2024
    assert row[5] is True
    assert row[11] == "AMK"
    assert row[12] == 152
    assert row[14] == 34
    assert row[16] == 84
