"""Builds the JSON payloads the frontend consumes.

Kept separate from the FastAPI routes so it can be unit-tested without HTTP
and so the routes stay a thin validation layer.
"""
from __future__ import annotations

from datetime import date, time, timedelta
from functools import lru_cache

import numpy as np
import pandas as pd

from . import analytics as A
from .config import DECISION_END, DECISION_START, ERROR_WINDOW_DAYS, HISTORY_START, UK_TZ
from .data import load_actuals, load_forecasts


def _r(x, nd: int = 1):
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return None
    return round(float(x), nd)


def _iso(ts: pd.Timestamp) -> str:
    return ts.strftime("%Y-%m-%dT%H:%M:%SZ")


def _round_metrics(m: dict) -> dict:
    return {k: (_r(v, 3) if k == "nmae" else _r(v) if isinstance(v, float) else v) for k, v in m.items()}


def _days(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


@lru_cache(maxsize=8)
def decision_history(gate: time) -> pd.DataFrame:
    """Decision forecasts vs actuals for every day we hold data for (Dec warm-up + Jan)."""
    return A.decision_errors(load_forecasts(), load_actuals(), _days(HISTORY_START, DECISION_END), gate)


def _apply_band(rows: pd.DataFrame, band: dict | None) -> pd.DataFrame:
    rows = rows.copy()
    if band:
        rows["low"] = (rows["forecast"] + band["p10"]).clip(lower=0)
        rows["high"] = rows["forecast"] + band["p90"]
        rows["corrected"] = (rows["forecast"] + band["p50"]).clip(lower=0)
    else:
        rows["low"] = rows["high"] = rows["corrected"] = np.nan
    return rows


# --------------------------------------------------------------------------- #
# decision desk
# --------------------------------------------------------------------------- #
def decision(decision_day: date, gate: time) -> dict:
    fc, act = load_forecasts(), load_actuals()
    delivery_day = decision_day + timedelta(days=1)
    gate_utc = A.gate_closure_utc(decision_day, gate)
    run, rows = A.decision_forecast(fc, decision_day, gate)

    band = A.error_band(decision_history(gate), decision_day, ERROR_WINDOW_DAYS)
    rows = A.attach_actuals(rows, act)
    rows = _apply_band(rows, band)

    start, end = A.uk_day_window(delivery_day)
    hh = act[(act["start_time"] >= start) & (act["start_time"] < end)]

    in_band = None
    if band and rows["actual"].notna().any():
        ok = rows.dropna(subset=["actual"])
        in_band = float(((ok["actual"] >= ok["low"]) & (ok["actual"] <= ok["high"])).mean())

    hindsight = A.error_metrics(rows["error"], rows["actual"])
    if band:
        hindsight["corrected_mae"] = float((rows["actual"] - rows["corrected"]).abs().mean())
    hindsight["coverage"] = in_band

    # how the forecast for this delivery day evolved over the runs before the gate
    vintages = []
    prior_runs = sorted(fc.loc[(fc["publish_time"] <= gate_utc) &
                               (fc["publish_time"] > gate_utc - pd.Timedelta(hours=48)), "publish_time"].unique())
    for p in prior_runs:
        v = fc[(fc["publish_time"] == p) & (fc["start_time"] >= start) & (fc["start_time"] < end)]
        if len(v) >= 12:
            vintages.append({
                "publish_time": _iso(pd.Timestamp(p)),
                "points": [{"start_time": _iso(t), "forecast": _r(g)} for t, g in zip(v["start_time"], v["generation"])],
            })

    return {
        "decision_day": decision_day.isoformat(),
        "delivery_day": delivery_day.isoformat(),
        "gate": gate.strftime("%H:%M"),
        "gate_utc": _iso(gate_utc),
        "run_publish_time": _iso(run) if run is not None else None,
        "run_age_h": _r((gate_utc - run).total_seconds() / 3600) if run is not None else None,
        "band": {k: (_r(v) if isinstance(v, float) else v) for k, v in band.items()} if band else None,
        "hours": [
            {
                "start_time": _iso(r.start_time),
                "lead_h": _r((r.start_time - run).total_seconds() / 3600),
                "forecast": _r(r.forecast), "low": _r(r.low), "high": _r(r.high),
                "corrected": _r(r.corrected), "actual": _r(r.actual),
            }
            for r in rows.itertuples()
        ],
        "actuals_halfhourly": [{"start_time": _iso(t), "actual": _r(g)} for t, g in zip(hh["start_time"], hh["generation"])],
        "summary": {
            # hourly forecast values -> MWh by multiplying by 1h; half-hourly actuals by 0.5h
            "forecast_mwh": _r(rows["forecast"].sum(), 0),
            "conservative_mwh": _r(rows["low"].sum(), 0) if band else None,
            "corrected_mwh": _r(rows["corrected"].sum(), 0) if band else None,
            "actual_mwh": _r(hh["generation"].sum() * 0.5, 0) if len(hh) else None,
            "min_forecast_mw": _r(rows["forecast"].min()),
            "peak_forecast_mw": _r(rows["forecast"].max()),
        },
        "hindsight": _round_metrics(hindsight),
        "vintages": vintages,
    }


# --------------------------------------------------------------------------- #
# forecast vs actual explorer
# --------------------------------------------------------------------------- #
def series(start_day: date, end_day: date, horizon_h: float) -> dict:
    fc, act = load_forecasts(), load_actuals()
    start, _ = A.uk_day_window(start_day)
    _, end = A.uk_day_window(end_day)
    f = A.attach_actuals(A.forecast_at_horizon(fc, A.hourly_targets(start, end), horizon_h), act)
    a = act[(act["start_time"] >= start) & (act["start_time"] < end)]
    return {
        "start_day": start_day.isoformat(),
        "end_day": end_day.isoformat(),
        "horizon_h": horizon_h,
        "actual": [{"start_time": _iso(t), "actual": _r(g)} for t, g in zip(a["start_time"], a["generation"])],
        "forecast": [
            {"start_time": _iso(r.start_time), "publish_time": _iso(r.publish_time), "forecast": _r(r.forecast)}
            for r in f.itertuples()
        ],
        "metrics": _round_metrics(A.error_metrics(f["error"], f["actual"])),
    }


# --------------------------------------------------------------------------- #
# accuracy lab
# --------------------------------------------------------------------------- #
@lru_cache(maxsize=4)
def horizon_accuracy(start_day: date, end_day: date) -> list[dict]:
    start, _ = A.uk_day_window(start_day)
    _, end = A.uk_day_window(end_day)
    curve = A.horizon_curve(load_forecasts(), load_actuals(), start, end, list(range(0, 49)))
    return [_round_metrics(m) for m in curve]


@lru_cache(maxsize=8)
def decision_accuracy(gate: time) -> dict:
    hist = decision_history(gate)
    jan_days = _days(DECISION_START, DECISION_END)

    # every January decision gets the band it would have had *at the time*
    frames, daily = [], []
    for d in jan_days:
        rows = hist[hist["decision_day"] == d]
        if rows.empty:
            continue
        band = A.error_band(hist, d, ERROR_WINDOW_DAYS)
        rows = _apply_band(rows, band)
        frames.append(rows)
        ok = rows.dropna(subset=["actual"])
        cov = float(((ok["actual"] >= ok["low"]) & (ok["actual"] <= ok["high"])).mean()) if band and len(ok) else None
        f_mwh, a_mwh = float(ok["forecast"].sum()), float(ok["actual"].sum())
        daily.append({
            "decision_day": d.isoformat(),
            "delivery_day": (d + timedelta(days=1)).isoformat(),
            "forecast_mwh": _r(f_mwh, 0), "actual_mwh": _r(a_mwh, 0),
            "energy_error_pct": _r(100 * (a_mwh - f_mwh) / f_mwh) if f_mwh else None,
            "mae": _r(ok["error"].abs().mean()),
            "corrected_mae": _r((ok["actual"] - ok["corrected"]).abs().mean()) if band else None,
            "bias": _r(ok["error"].mean()),
            "coverage": _r(cov, 3),
        })
    jan = pd.concat(frames, ignore_index=True).dropna(subset=["actual"])
    jan["corrected_error"] = jan["actual"] - jan["corrected"]
    jan["hour_local"] = jan["start_time"].dt.tz_convert(UK_TZ).dt.hour
    jan["lead_h"] = (jan["start_time"] - jan["publish_time"]).dt.total_seconds() / 3600

    by_hour = [
        {"hour": int(h), "mae": _r(g["error"].abs().mean()), "bias": _r(g["error"].mean()),
         "corrected_mae": _r(g["corrected_error"].abs().mean())}
        for h, g in jan.groupby("hour_local")
    ]
    edges = [0, 4000, 8000, 12000, 16000, 25000]
    labels = ["0-4 GW", "4-8 GW", "8-12 GW", "12-16 GW", "16+ GW"]
    jan["level"] = pd.cut(jan["forecast"], bins=edges, labels=labels, right=False)
    by_level = [
        {"level": str(lvl), "n": int(len(g)), "mae": _r(g["error"].abs().mean()), "bias": _r(g["error"].mean())}
        for lvl, g in jan.groupby("level", observed=True)
    ]
    covered = jan.dropna(subset=["low"])
    return {
        "gate": gate.strftime("%H:%M"),
        "lead_range_h": [_r(jan["lead_h"].min()), _r(jan["lead_h"].max())],
        "overall": _round_metrics(A.error_metrics(jan["error"], jan["actual"])),
        "overall_corrected": _round_metrics(A.error_metrics(jan["corrected_error"], jan["actual"])),
        "coverage": _r(((covered["actual"] >= covered["low"]) & (covered["actual"] <= covered["high"])).mean(), 3),
        "by_hour": by_hour,
        "by_level": by_level,
        "histogram": A.histogram(jan["error"]),
        "daily": daily,
    }


def meta() -> dict:
    fc, act = load_forecasts(), load_actuals()
    runs = fc["publish_time"].drop_duplicates()
    return {
        "decision_start": DECISION_START.isoformat(),
        "decision_end": DECISION_END.isoformat(),
        "delivery_start": (DECISION_START + timedelta(days=1)).isoformat(),
        "delivery_end": (DECISION_END + timedelta(days=1)).isoformat(),
        "gates": [{"label": "EPEX GB day-ahead (09:20)", "value": "09:20"},
                  {"label": "Nord Pool N2EX day-ahead (09:50)", "value": "09:50"}],
        "forecast_runs": int(len(runs)),
        "run_times_utc": sorted(runs.dt.strftime("%H:%M").unique().tolist()),
        "actuals_from": _iso(act["start_time"].min()),
        "actuals_to": _iso(act["start_time"].max()),
        "error_window_days": ERROR_WINDOW_DAYS,
    }
