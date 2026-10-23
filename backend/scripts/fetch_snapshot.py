"""Download the data the app needs and store it as gzipped JSON snapshots.

    python -m scripts.fetch_snapshot      (run from backend/)

The app reads from these files, so the deployed demo never depends on
Elexon being reachable at request time.
"""
import gzip
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import ACTUALS_FILE, DATA_END, FORECASTS_FILE, HISTORY_START  # noqa: E402
from app.elexon import fetch_wind_actuals, fetch_wind_forecasts  # noqa: E402


def _write(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump(rows, fh, separators=(",", ":"))
    print(f"wrote {len(rows):>6} rows -> {path.name}")


def main() -> None:
    _write(ACTUALS_FILE, fetch_wind_actuals(HISTORY_START, DATA_END))
    # forecasts published up to the end of the last decision day are enough
    _write(FORECASTS_FILE, fetch_wind_forecasts(HISTORY_START, DATA_END))


if __name__ == "__main__":
    main()
