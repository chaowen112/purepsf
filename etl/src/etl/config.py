"""Central config: env vars, DB connection, source URLs."""
from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Config:
    database_url: str
    ura_access_key: str
    onemap_email: str
    onemap_password: str

    # API endpoints
    ura_data_service_base: str = "https://eservice.ura.gov.sg/uraDataService/invokeUraDS/v1"
    ura_token_url: str = "https://eservice.ura.gov.sg/uraDataService/insertNewToken/v1"
    hdb_resale_resource_id: str = "d_8b84c4ee58e3cfc0ece0d773c8ca6abc"
    hdb_resale_url: str = "https://data.gov.sg/api/action/datastore_search"
    onemap_search_url: str = "https://www.onemap.gov.sg/api/common/elastic/search"
    onemap_token_url: str = "https://www.onemap.gov.sg/api/auth/post/getToken"


def load() -> Config:
    return Config(
        database_url=_required("DATABASE_URL"),
        ura_access_key=_required("URA_ACCESS_KEY"),
        onemap_email=os.environ.get("ONEMAP_EMAIL", ""),
        onemap_password=os.environ.get("ONEMAP_PASSWORD", ""),
    )


def _required(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        raise RuntimeError(f"env var {name} is required")
    return v
