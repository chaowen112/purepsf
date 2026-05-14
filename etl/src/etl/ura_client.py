"""URA Data Service API client.

Auth flow:
1. POST {token_url} with header AccessKey → JSON {"Result": "<token>"}. Token valid for the day.
2. Subsequent data calls send both AccessKey and Token headers.

We cache the token to disk to avoid hammering the token endpoint on each ETL run.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)

TOKEN_CACHE = Path.home() / ".cache" / "purepsf" / "ura_token.json"


@dataclass
class URAClient:
    access_key: str
    token_url: str = "https://eservice.ura.gov.sg/uraDataService/insertNewToken/v1"
    data_url: str = "https://eservice.ura.gov.sg/uraDataService/invokeUraDS/v1"
    user_agent: str = "purePSF/0.1 (https://github.com/chaowenchen/purePSF)"
    _token: str | None = None
    _token_date: date | None = None

    def __post_init__(self) -> None:
        cached = _load_cached_token()
        if cached is not None:
            self._token, self._token_date = cached

    def _ensure_token(self) -> str:
        today = date.today()
        if self._token and self._token_date == today:
            return self._token
        logger.info("requesting new URA token")
        resp = httpx.get(
            self.token_url,
            headers={
                "AccessKey": self.access_key,
                "User-Agent": self.user_agent,
            },
            timeout=30,
        )
        resp.raise_for_status()
        payload = resp.json()
        if payload.get("Status") != "Success":
            raise RuntimeError(f"URA token request failed: {payload}")
        token = payload["Result"]
        self._token = token
        self._token_date = today
        _save_cached_token(token, today)
        return token

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=20))
    def fetch_residential_transactions(self, batch: int) -> list[dict[str, Any]]:
        """Return the list of project-level records for one batch (1..4)."""
        token = self._ensure_token()
        resp = httpx.get(
            self.data_url,
            params={"service": "PMI_Resi_Transaction", "batch": batch},
            headers={
                "AccessKey": self.access_key,
                "Token": token,
                "User-Agent": self.user_agent,
            },
            timeout=60,
        )
        resp.raise_for_status()
        try:
            payload = resp.json()
        except UnicodeDecodeError:
            # URA occasionally returns non-UTF-8 bytes in project names; replace them.
            import json as _json
            payload = _json.loads(resp.content.decode("utf-8", errors="replace"))
        status = payload.get("Status")
        if status != "Success":
            raise RuntimeError(f"URA data request failed (batch={batch}): {payload}")
        result = payload.get("Result", [])
        logger.info("URA batch=%d returned %d projects", batch, len(result))
        # be polite
        time.sleep(0.5)
        return result


def _load_cached_token() -> tuple[str, date] | None:
    if not TOKEN_CACHE.exists():
        return None
    try:
        data = json.loads(TOKEN_CACHE.read_text())
        return data["token"], date.fromisoformat(data["date"])
    except (KeyError, ValueError, OSError):
        return None


def _save_cached_token(token: str, when: date) -> None:
    TOKEN_CACHE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_CACHE.write_text(json.dumps({"token": token, "date": when.isoformat()}))


def parse_contract_date(mmyy: str) -> date:
    """URA returns contract date as MMYY (e.g. '0524' = May 2024). We store first-of-month."""
    if len(mmyy) != 4 or not mmyy.isdigit():
        raise ValueError(f"unexpected contractDate format: {mmyy!r}")
    month = int(mmyy[:2])
    year = 2000 + int(mmyy[2:])
    if not 1 <= month <= 12:
        raise ValueError(f"unexpected month in contractDate: {mmyy!r}")
    return date(year, month, 1)


# Mapping from URA's compact codes to human strings.
TYPE_OF_SALE = {
    "1": "New Sale",
    "2": "Sub Sale",
    "3": "Resale",
}


def normalize_type_of_sale(code: str | None) -> str | None:
    if code is None:
        return None
    return TYPE_OF_SALE.get(str(code), str(code))
