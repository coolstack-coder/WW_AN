from datetime import date, time

import pandas as pd
import pytest

from app import analytics as A
from app.data import tidy_actuals, tidy_forecasts


def ts(s):
    return pd.Timestamp(s, tz="UTC")


@pytest.fixture
def fc():
    # two runs for the same target hours; the later run is "better informed"
    raw = pd.DataFrame([
        {"publishTime": "2026-01-10T04:30:00Z", "startTime": "2026-01-11T00:00:00Z", "generation": 100},
        {"publishTime": "2026-01-10T04:30:00Z", "startTime": "2026-01-11T01:00:00Z", "generation": 110},
        {"publishTime": "2026-01-10T10:30:00Z", "startTime": "2026-01-11T00:00:00Z", "generation": 200},
        {"publishTime": "2026-01-10T10:30:00Z", "startTime": "2026-01-11T01:00:00Z", "generation": 210},
        # a backward-looking row that must be thrown away
        {"publishTime": "2026-01-10T10:30:00Z", "startTime": "2026-01-10T09:00:00Z", "generation": 999},
    ])
    return tidy_forecasts(raw)


def test_tidy_forecasts_drops_past_targets(fc):
    assert (fc["start_time"] >= fc["publish_time"]).all()
    assert 999 not in fc["generation"].tolist()


def test_tidy_actuals_keeps_latest_republish():
    raw = pd.DataFrame([
        {"startTime": "2026-01-11T00:00:00Z", "publishTime": "2026-01-11T00:30:00Z", "generation": 5},
        {"startTime": "2026-01-11T00:00:00Z", "publishTime": "2026-01-11T02:00:00Z", "generation": 7},
    ])
    out = tidy_actuals(raw)
    assert out["generation"].tolist() == [7]


def test_horizon_picks_latest_run_old_enough(fc):
    targets = pd.DatetimeIndex([ts("2026-01-11T00:00")])
    # 14h before target = 10:00 on the 10th -> only the 04:30 run qualifies
    assert A.forecast_at_horizon(fc, targets, 14)["forecast"].tolist() == [100]
    # 12h before target = 12:00 -> the 10:30 run is allowed
    assert A.forecast_at_horizon(fc, targets, 12)["forecast"].tolist() == [200]


def test_horizon_drops_targets_without_forecast(fc):
    targets = pd.DatetimeIndex([ts("2026-01-11T00:00")])
    assert A.forecast_at_horizon(fc, targets, 30).empty


def test_decision_forecast_respects_gate(fc):
    # gate 09:20 UK (= UTC in January) on the 10th: 10:30 run is not yet out
    run, rows = A.decision_forecast(fc, date(2026, 1, 10), time(9, 20))
    assert run == ts("2026-01-10T04:30")
    assert rows["forecast"].tolist() == [100, 110]


def test_uk_day_window_handles_bst():
    start, end = A.uk_day_window(date(2026, 7, 1))
    assert start == ts("2026-06-30T23:00")
    assert end - start == pd.Timedelta(hours=24)
    # clocks go forward on 29 Mar 2026 -> 23h day
    s, e = A.uk_day_window(date(2026, 3, 29))
    assert e - s == pd.Timedelta(hours=23)


def test_error_band_has_no_lookahead():
    hist = pd.DataFrame({
        "decision_day": [date(2026, 1, d) for d in range(1, 11) for _ in range(24)],
        "error": [float(d) for d in range(1, 11) for _ in range(24)],
    })
    band = A.error_band(hist, date(2026, 1, 10), window_days=28)
    # day 10 may only see decisions up to day 8 (delivery day 9 finished)
    assert band["to"] == "2026-01-08"
    assert band["p90"] <= 8


def test_error_band_needs_enough_history():
    hist = pd.DataFrame({"decision_day": [date(2026, 1, 1)] * 24, "error": [1.0] * 24})
    assert A.error_band(hist, date(2026, 1, 3), 28) is None


def test_error_metrics_sign_convention():
    m = A.error_metrics(pd.Series([-100.0, -300.0]), pd.Series([1000.0, 1000.0]))
    assert m["bias"] == -200  # actual below forecast -> negative
    assert m["mae"] == 200
    assert m["nmae"] == pytest.approx(0.2)
