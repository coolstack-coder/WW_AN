"""HTTP layer. Validation lives here, maths lives in analytics/service."""
from __future__ import annotations

import os
from datetime import date, time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import service
from .config import DATA_END, DECISION_END, DECISION_START, HISTORY_START

app = FastAPI(
    title="Wind Watch API",
    description="Day-ahead wind forecast insight for GB power procurement (Elexon FUELHH + WINDFOR).",
    version="1.0.0",
)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["GET"],
    allow_headers=["*"],
)

ALLOWED_GATES = {"09:20": time(9, 20), "09:50": time(9, 50)}


def _gate(value: str) -> time:
    if value not in ALLOWED_GATES:
        raise HTTPException(422, f"gate must be one of {sorted(ALLOWED_GATES)}")
    return ALLOWED_GATES[value]


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/meta")
def meta():
    return service.meta()


@app.get("/api/decision")
def decision(day: date = Query(..., description="Decision day (UK), Jan 2026"), gate: str = "09:20"):
    if not DECISION_START <= day <= DECISION_END:
        raise HTTPException(422, f"day must be between {DECISION_START} and {DECISION_END}")
    return service.decision(day, _gate(gate))


@app.get("/api/series")
def series(
    start: date = Query(..., description="First delivery day (UK)"),
    end: date = Query(..., description="Last delivery day (UK), inclusive"),
    horizon: float = Query(24, ge=0, le=48, description="Minimum forecast horizon in hours"),
):
    if start > end:
        raise HTTPException(422, "start must not be after end")
    if start < HISTORY_START or end >= DATA_END:
        raise HTTPException(422, f"range must sit within {HISTORY_START}..{DATA_END}")
    if (end - start).days > 62:
        raise HTTPException(422, "range is limited to 62 days")
    return service.series(start, end, horizon)


@app.get("/api/accuracy/horizons")
def accuracy_horizons():
    # fixed to the January delivery window so results are cacheable
    return service.horizon_accuracy(date(2026, 1, 2), date(2026, 2, 1))


@app.get("/api/accuracy/decisions")
def accuracy_decisions(gate: str = "09:20"):
    return service.decision_accuracy(_gate(gate))


# --------------------------------------------------------------------------- #
# Serve the built React app when it is present (Docker image). On Vercel the
# static files are served by the platform and this block is skipped.
# --------------------------------------------------------------------------- #
STATIC_DIR = Path(os.getenv("STATIC_DIR", Path(__file__).resolve().parents[2] / "frontend" / "dist"))

if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        file = STATIC_DIR / path
        if path and file.is_file():
            return FileResponse(file)
        return FileResponse(STATIC_DIR / "index.html")
