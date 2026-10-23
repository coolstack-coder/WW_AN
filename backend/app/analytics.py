"""Forecast selection and accuracy maths.

Two ideas drive everything in here:

1. *Horizon view* - for every target hour T, use the latest forecast that was
   published at least H hours before T. This answers "how good is the
   forecast when I look at it H hours ahead?".

2. *Decision view* - for a decision taken on day D at gate closure G, use the
   single latest forecast run published before G, and read off delivery day
   D+1. This is exactly what a day-ahead buyer sees on their screen.

Error is always reported as  actual - forecast  (MW):
positive  -> wind came in above forecast (we over-bought)
negative  -> wind under-delivered (we are short and exposed to imbalance)
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

import numpy as np
import pandas as pd

from .config import UK_TZ


# --------------------------------------------------------------------------- #
# time helpers
# --------------------------------------------------------------------------- #
def uk_day_window(day: date) -> tuple[pd.Timestamp, pd.Timestamp]:
    """[start, end) of a UK local calendar day, expressed in UTC."""
    start = datetime.combine(day, time(0), tzinfo=UK_TZ)
    end = datetime.combine(day + timedelta(days=1), time(0), tzinfo=UK_TZ)
    return pd.Timestamp(start).tz_convert("UTC"), pd.Timestamp(end).tz_convert("UTC")


def gate_closure_utc(decision_day: date, gate: time) -> pd.Timestamp:
    return pd.Timestamp(datetime.combine(decision_day, gate, tzinfo=UK_TZ)).tz_convert("UTC")


def hourly_targets(start: pd.Timestamp, end: pd.Timestamp) -> pd.DatetimeIndex:
    return pd.date_range(start, end, freq="1h", inclusive="left", tz="UTC")


# --------------------------------------------------------------------------- #
# forecast selection
# --------------------------------------------------------------------------- #
def forecast_at_horizon(fc: pd.DataFrame, targets: pd.DatetimeIndex, horizon_h: float) -> pd.DataFrame:
    """Latest forecast for each target published at least `horizon_h` hours before it.

    Targets without any qualifying forecast are dropped.
    """
    left = pd.DataFrame({"start_time": targets})
    left["cutoff"] = left["start_time"] - pd.Timedelta(hours=horizon_h)
    left = left.sort_values("cutoff")
    right = fc[["publish_time", "start_time", "generation"]].sort_values("publish_time")
    merged = pd.merge_asof(
        left, right,
        left_on="cutoff", right_on="publish_time",
        by="start_time", direction="backward",
    )
    merged = merged.dropna(subset=["generation"]).rename(columns={"generation": "forecast"})
    return merged[["start_time", "publish_time", "forecast"]].sort_values("start_time").reset_index(drop=True)


def latest_run_before(fc: pd.DataFrame, as_of: pd.Timestamp) -> pd.Timestamp | None:
    runs = fc.loc[fc["publish_time"] <= as_of, "publish_time"]
    return None if runs.empty else runs.max()


def decision_forecast(fc: pd.DataFrame, decision_day: date, gate: time) -> tuple[pd.Timestamp | None, pd.DataFrame]:
    """The forecast run a buyer would have used, cut to the delivery day."""
    as_of = gate_closure_utc(decision_day, gate)
    run = latest_run_before(fc, as_of)
    if run is None:
        return None, pd.DataFrame(columns=["start_time", "forecast"])
    start, end = uk_day_window(decision_day + timedelta(days=1))
    rows = fc[(fc["publish_time"] == run) & (fc["start_time"] >= start) & (fc["start_time"] < end)]
    out = rows[["start_time", "generation"]].rename(columns={"generation": "forecast"})
    return run, out.reset_index(drop=True)


def attach_actuals(df: pd.DataFrame, act: pd.DataFrame) -> pd.DataFrame:
    """Join actual outturn on the exact target start time and compute error."""
    out = df.merge(act.rename(columns={"generation": "actual"}), on="start_time", how="left")
    out["error"] = out["actual"] - out["forecast"]
    return out


def decision_errors(fc: pd.DataFrame, act: pd.DataFrame, days: list[date], gate: time) -> pd.DataFrame:
    """Hour-by-hour decision forecast vs actual for a list of decision days."""
    frames = []
    for d in days:
        run, rows = decision_forecast(fc, d, gate)
        if rows.empty:
            continue
        rows = attach_actuals(rows, act)
        rows["decision_day"] = d
        rows["publish_time"] = run
        frames.append(rows)
    if not frames:
        return pd.DataFrame(columns=["decision_day", "publish_time", "start_time", "forecast", "actual", "error"])
    return pd.concat(frames, ignore_index=True)


# --------------------------------------------------------------------------- #
# uncertainty band
# --------------------------------------------------------------------------- #
def error_band(history: pd.DataFrame, decision_day: date, window_days: int) -> dict | None:
    """Empirical P10/P50/P90 of past decision errors, with no look-ahead.

    Only decisions whose delivery day had fully finished before `decision_day`
    started are used: a decision on day d delivers on d+1, which is complete
    by 00:00 on d+2, so d <= decision_day - 2.
    """
    last_ok = decision_day - timedelta(days=2)
    first_ok = last_ok - timedelta(days=window_days - 1)
    h = history[(history["decision_day"] >= first_ok) & (history["decision_day"] <= last_ok)]
    errs = h["error"].dropna().to_numpy()
    if len(errs) < 48:  # need at least a couple of days to say anything
        return None
    p10, p50, p90 = np.percentile(errs, [10, 50, 90])
    return {
        "p10": float(p10), "p50": float(p50), "p90": float(p90),
        "n": int(len(errs)), "from": first_ok.isoformat(), "to": last_ok.isoformat(),
    }


# --------------------------------------------------------------------------- #
# metrics
# --------------------------------------------------------------------------- #
def error_metrics(err: pd.Series, actual: pd.Series | None = None) -> dict:
    e = err.dropna().to_numpy(dtype=float)
    if len(e) == 0:
        return {"n": 0}
    abs_e = np.abs(e)
    out = {
        "n": int(len(e)),
        "mae": float(abs_e.mean()),
        "rmse": float(np.sqrt((e ** 2).mean())),
        "bias": float(e.mean()),
        "p10": float(np.percentile(e, 10)),
        "p50": float(np.percentile(e, 50)),
        "p90": float(np.percentile(e, 90)),
        "p95_abs": float(np.percentile(abs_e, 95)),
        "max_abs": float(abs_e.max()),
    }
    if actual is not None:
        mean_actual = float(actual.dropna().mean())
        out["mean_actual"] = mean_actual
        # normalised MAE: MAPE explodes on calm hours, nMAE does not
        out["nmae"] = out["mae"] / mean_actual if mean_actual else None
    return out


def horizon_curve(fc: pd.DataFrame, act: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp,
                  horizons: list[float]) -> list[dict]:
    targets = hourly_targets(start, end)
    out = []
    for h in horizons:
        joined = attach_actuals(forecast_at_horizon(fc, targets, h), act)
        joined = joined.dropna(subset=["actual"])
        m = error_metrics(joined["error"], joined["actual"])
        m["horizon_h"] = h
        out.append(m)
    return out


def histogram(values: pd.Series, bin_width: float = 500.0) -> list[dict]:
    v = values.dropna().to_numpy(dtype=float)
    if len(v) == 0:
        return []
    lo = np.floor(v.min() / bin_width) * bin_width
    hi = np.ceil(v.max() / bin_width) * bin_width + bin_width
    counts, edges = np.histogram(v, bins=np.arange(lo, hi, bin_width))
    return [{"from": float(a), "to": float(b), "count": int(c)} for a, b, c in zip(edges[:-1], edges[1:], counts)]
