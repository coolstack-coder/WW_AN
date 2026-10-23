from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    assert client.get("/api/health").json() == {"status": "ok"}


def test_decision_uses_run_before_gate():
    body = client.get("/api/decision", params={"day": "2026-01-15", "gate": "09:20"}).json()
    assert body["delivery_day"] == "2026-01-16"
    assert body["run_publish_time"] <= body["gate_utc"]
    assert len(body["hours"]) == 24
    assert body["band"] is not None


def test_decision_rejects_out_of_scope_day():
    assert client.get("/api/decision", params={"day": "2026-02-10"}).status_code == 422


def test_decision_rejects_unknown_gate():
    assert client.get("/api/decision", params={"day": "2026-01-10", "gate": "11:00"}).status_code == 422


def test_series_validates_range():
    assert client.get("/api/series", params={"start": "2026-01-12", "end": "2026-01-10"}).status_code == 422
    ok = client.get("/api/series", params={"start": "2026-01-10", "end": "2026-01-11", "horizon": 4})
    assert ok.status_code == 200
    assert ok.json()["metrics"]["n"] > 0


def test_horizon_accuracy_grows_with_horizon():
    curve = client.get("/api/accuracy/horizons").json()
    assert curve[0]["horizon_h"] == 0 and curve[-1]["horizon_h"] == 48
    assert curve[0]["mae"] < curve[36]["mae"]


def test_decision_accuracy_shape():
    body = client.get("/api/accuracy/decisions").json()
    assert len(body["daily"]) == 31
    assert 0 <= body["coverage"] <= 1
