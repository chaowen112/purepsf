CREATE TABLE IF NOT EXISTS external_project_links (
    project_id      BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    provider        TEXT NOT NULL,
    url_sale        TEXT,
    url_rent        TEXT,
    url_project     TEXT,
    match_method    TEXT,
    confidence      DOUBLE PRECISION,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_external_project_links_provider
    ON external_project_links (provider);
