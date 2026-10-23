"""Central place for the knobs the rest of the backend relies on."""
from datetime import date, time
from pathlib import Path
from zoneinfo import ZoneInfo

UK_TZ = ZoneInfo("Europe/London")

ELEXON_BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets"

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
ACTUALS_FILE = DATA_DIR / "fuelhh_wind.json.gz"
FORECASTS_FILE = DATA_DIR / "windfor.json.gz"

# Scope of the pilot: purchase decisions taken in January 2026.
# A decision on day D buys power for delivery day D+1.
DECISION_START = date(2026, 1, 1)
DECISION_END = date(2026, 1, 31)

# December is pulled in as "warm-up" history so that even the first
# January decision has past forecast errors to build an uncertainty band from.
HISTORY_START = date(2025, 12, 1)
DATA_END = date(2026, 2, 2)

# EPEX SPOT GB day-ahead hourly auction closes at 09:20 UK time.
# Nord Pool (N2EX) closes at 09:50. Users can pick either in the UI.
DEFAULT_GATE_CLOSURE = time(9, 20)

# How many past decision days feed the empirical error band.
ERROR_WINDOW_DAYS = 28
