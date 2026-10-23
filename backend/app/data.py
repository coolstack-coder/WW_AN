"""Load the snapshot files into tidy, de-duplicated DataFrames.

Everything is kept in UTC internally; conversion to UK local time only
happens where a business rule needs it (delivery days, gate closure).
"""
from __future__ import annotations

import gzip
import json
from functools import lru_cache
from pathlib import Path

import pandas as pd

from .config import ACTUALS_FILE, FORECASTS_FILE


def _read(path: Path) -> pd.DataFrame:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return pd.DataFrame(json.load(fh))


def tidy_actuals(raw: pd.DataFrame) -> pd.DataFrame:
    df = raw.copy()
    df["start_time"] = pd.to_datetime(df["startTime"], utc=True)
    df["publish_time"] = pd.to_datetime(df["publishTime"], utc=True)
    # A settlement period can be re-published; the latest value wins.
    df = df.sort_values("publish_time").drop_duplicates("start_time", keep="last")
    return (
        df[["start_time", "generation"]]
        .sort_values("start_time")
        .reset_index(drop=True)
    )


def tidy_forecasts(raw: pd.DataFrame) -> pd.DataFrame:
    df = raw.copy()
    df["start_time"] = pd.to_datetime(df["startTime"], utc=True)
    df["publish_time"] = pd.to_datetime(df["publishTime"], utc=True)
    df = df.drop_duplicates(["publish_time", "start_time"], keep="last")
    # Only forecasts *ahead* of the target time are useful for a buyer.
    df = df[df["start_time"] >= df["publish_time"]]
    df["horizon_h"] = (df["start_time"] - df["publish_time"]).dt.total_seconds() / 3600
    return (
        df[["publish_time", "start_time", "generation", "horizon_h"]]
        .sort_values(["publish_time", "start_time"])
        .reset_index(drop=True)
    )


@lru_cache(maxsize=1)
def load_actuals() -> pd.DataFrame:
    return tidy_actuals(_read(ACTUALS_FILE))


@lru_cache(maxsize=1)
def load_forecasts() -> pd.DataFrame:
    return tidy_forecasts(_read(FORECASTS_FILE))
