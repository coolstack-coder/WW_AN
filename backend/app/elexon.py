"""Thin client for the two Elexon Insights (BMRS) stream endpoints we use.

FUELHH  - half-hourly outturn generation by fuel type (we keep WIND only)
WINDFOR - wind generation forecasts, one "run" per publishTime, hourly values
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import httpx

from .config import ELEXON_BASE_URL

# The stream endpoints are happy with a month at a time, but chunking keeps
# individual responses small and makes retries cheap.
CHUNK_DAYS = 7


def _get(client: httpx.Client, path: str, params: dict) -> list[dict]:
    for attempt in range(3):
        try:
            resp = client.get(f"{ELEXON_BASE_URL}/{path}", params=params, timeout=60)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError:
            if attempt == 2:
                raise
    return []


def _date_chunks(start: date, end: date):
    cur = start
    while cur <= end:
        nxt = min(cur + timedelta(days=CHUNK_DAYS - 1), end)
        yield cur, nxt
        cur = nxt + timedelta(days=1)


def fetch_wind_actuals(start: date, end: date) -> list[dict]:
    """Wind outturn for settlement dates start..end (inclusive)."""
    rows: list[dict] = []
    with httpx.Client() as client:
        for a, b in _date_chunks(start, end):
            rows += _get(client, "FUELHH/stream", {
                "settlementDateFrom": a.isoformat(),
                "settlementDateTo": b.isoformat(),
                "fuelType": "WIND",
            })
    return [
        {"startTime": r["startTime"], "publishTime": r["publishTime"], "generation": r["generation"]}
        for r in rows
        if r.get("fuelType") == "WIND"
    ]


def fetch_wind_forecasts(start: date, end: date) -> list[dict]:
    """Every forecast run published between start 00:00Z and end 23:59Z."""
    rows: list[dict] = []
    with httpx.Client() as client:
        for a, b in _date_chunks(start, end):
            frm = datetime(a.year, a.month, a.day, tzinfo=timezone.utc)
            to = datetime(b.year, b.month, b.day, 23, 59, tzinfo=timezone.utc)
            rows += _get(client, "WINDFOR/stream", {
                "publishDateTimeFrom": frm.isoformat().replace("+00:00", "Z"),
                "publishDateTimeTo": to.isoformat().replace("+00:00", "Z"),
            })
    return [
        {"startTime": r["startTime"], "publishTime": r["publishTime"], "generation": r["generation"]}
        for r in rows
    ]
