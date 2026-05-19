-- Official HDB block-level metadata from data.gov.sg:
-- HDB Property Information (d_17f5382f26140b1fdae0ba2ef6239d2f).
-- This is metadata/enrichment, not transaction data.

CREATE TABLE IF NOT EXISTS hdb_property_info (
    project_key                 TEXT PRIMARY KEY,
    blk_no                      TEXT NOT NULL,
    street                      TEXT NOT NULL,
    max_floor_lvl               INT,
    year_completed              INT,
    residential                 BOOLEAN NOT NULL DEFAULT false,
    commercial                  BOOLEAN NOT NULL DEFAULT false,
    market_hawker               BOOLEAN NOT NULL DEFAULT false,
    miscellaneous               BOOLEAN NOT NULL DEFAULT false,
    multistorey_carpark         BOOLEAN NOT NULL DEFAULT false,
    precinct_pavilion           BOOLEAN NOT NULL DEFAULT false,
    bldg_contract_town          TEXT,
    total_dwelling_units        INT NOT NULL DEFAULT 0,
    one_room_sold               INT NOT NULL DEFAULT 0,
    two_room_sold               INT NOT NULL DEFAULT 0,
    three_room_sold             INT NOT NULL DEFAULT 0,
    four_room_sold              INT NOT NULL DEFAULT 0,
    five_room_sold              INT NOT NULL DEFAULT 0,
    exec_sold                   INT NOT NULL DEFAULT 0,
    multigen_sold               INT NOT NULL DEFAULT 0,
    studio_apartment_sold       INT NOT NULL DEFAULT 0,
    one_room_rental             INT NOT NULL DEFAULT 0,
    two_room_rental             INT NOT NULL DEFAULT 0,
    three_room_rental           INT NOT NULL DEFAULT 0,
    other_room_rental           INT NOT NULL DEFAULT 0,
    raw_record                  JSONB NOT NULL,
    fetched_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hdb_property_info_street ON hdb_property_info (street);
CREATE INDEX IF NOT EXISTS idx_hdb_property_info_year_completed ON hdb_property_info (year_completed);
CREATE INDEX IF NOT EXISTS idx_hdb_property_info_residential ON hdb_property_info (residential);

CREATE OR REPLACE FUNCTION hdb_property_info_touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hdb_property_info_updated_at ON hdb_property_info;
CREATE TRIGGER trg_hdb_property_info_updated_at
    BEFORE UPDATE ON hdb_property_info
    FOR EACH ROW EXECUTE FUNCTION hdb_property_info_touch_updated_at();
