-- CEA salesperson registry + their transaction records (data.gov.sg).
-- Powers the agent leaderboard and per-subzone agent ranking.
-- Idempotent: safe to re-apply.

CREATE TABLE IF NOT EXISTS salespeople (
    registration_no         TEXT PRIMARY KEY,
    salesperson_name        TEXT NOT NULL,
    estate_agent_name       TEXT,
    estate_agent_license_no TEXT,
    registration_start_date DATE,
    registration_end_date   DATE,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per CEA-recorded transaction. CEA data is deliberately de-identified
-- (no price, no address, month granularity), so this can't be joined to URA/HDB
-- transactions at row level — only aggregated by (town, property_type, month).
CREATE TABLE IF NOT EXISTS salesperson_transactions (
    id                  BIGSERIAL PRIMARY KEY,
    salesperson_reg_num TEXT NOT NULL,
    salesperson_name    TEXT,
    transaction_date    DATE NOT NULL,   -- first of month (CEA reports MMM-YYYY)
    property_type       TEXT,            -- HDB / CONDOMINIUM / LANDED / EXECUTIVE CONDOMINIUM
    transaction_type    TEXT,            -- RESALE / NEW SALE / RENTAL / SUB-SALE
    represented         TEXT,            -- SELLER / BUYER / LANDLORD / TENANT
    town                TEXT,            -- planning area, e.g. YISHUN, BISHAN
    district            TEXT,            -- D09, D10, ... or NULL for HDB
    general_location    TEXT
);

CREATE INDEX IF NOT EXISTS idx_sp_txn_reg      ON salesperson_transactions (salesperson_reg_num);
CREATE INDEX IF NOT EXISTS idx_sp_txn_town     ON salesperson_transactions (town);
CREATE INDEX IF NOT EXISTS idx_sp_txn_date     ON salesperson_transactions (transaction_date);
CREATE INDEX IF NOT EXISTS idx_sp_txn_ptype    ON salesperson_transactions (property_type);
CREATE INDEX IF NOT EXISTS idx_sp_txn_rep      ON salesperson_transactions (represented);
-- Composite covers the leaderboard's primary filter.
CREATE INDEX IF NOT EXISTS idx_sp_txn_filter   ON salesperson_transactions (town, property_type, represented);
