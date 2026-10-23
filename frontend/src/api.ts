// Typed wrappers around the FastAPI endpoints.

const BASE = import.meta.env.VITE_API_BASE ?? "";

async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const url = `${BASE}${path}${qs.toString() ? `?${qs}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export interface Metrics {
  n: number;
  mae?: number;
  rmse?: number;
  bias?: number;
  p10?: number;
  p50?: number;
  p90?: number;
  p95_abs?: number;
  max_abs?: number;
  mean_actual?: number;
  nmae?: number | null;
  corrected_mae?: number;
  coverage?: number | null;
}

export interface Meta {
  decision_start: string;
  decision_end: string;
  delivery_start: string;
  delivery_end: string;
  gates: { label: string; value: string }[];
  forecast_runs: number;
  run_times_utc: string[];
  actuals_from: string;
  actuals_to: string;
  error_window_days: number;
}

export interface DecisionHour {
  start_time: string;
  lead_h: number;
  forecast: number;
  low: number | null;
  high: number | null;
  corrected: number | null;
  actual: number | null;
}

export interface Decision {
  decision_day: string;
  delivery_day: string;
  gate: string;
  gate_utc: string;
  run_publish_time: string | null;
  run_age_h: number | null;
  band: { p10: number; p50: number; p90: number; n: number; from: string; to: string } | null;
  hours: DecisionHour[];
  actuals_halfhourly: { start_time: string; actual: number }[];
  summary: {
    forecast_mwh: number;
    conservative_mwh: number | null;
    corrected_mwh: number | null;
    actual_mwh: number | null;
    min_forecast_mw: number;
    peak_forecast_mw: number;
  };
  hindsight: Metrics;
  vintages: { publish_time: string; points: { start_time: string; forecast: number }[] }[];
}

export interface Series {
  start_day: string;
  end_day: string;
  horizon_h: number;
  actual: { start_time: string; actual: number }[];
  forecast: { start_time: string; publish_time: string; forecast: number }[];
  metrics: Metrics;
}

export interface HorizonPoint extends Metrics {
  horizon_h: number;
}

export interface DailyDecision {
  decision_day: string;
  delivery_day: string;
  forecast_mwh: number;
  actual_mwh: number;
  energy_error_pct: number | null;
  mae: number;
  corrected_mae: number | null;
  bias: number;
  coverage: number | null;
}

export interface DecisionAccuracy {
  gate: string;
  lead_range_h: [number, number];
  overall: Metrics;
  overall_corrected: Metrics;
  coverage: number;
  by_hour: { hour: number; mae: number; bias: number; corrected_mae: number }[];
  by_level: { level: string; n: number; mae: number; bias: number }[];
  histogram: { from: number; to: number; count: number }[];
  daily: DailyDecision[];
}

export const api = {
  meta: () => get<Meta>("/api/meta"),
  decision: (day: string, gate: string) => get<Decision>("/api/decision", { day, gate }),
  series: (start: string, end: string, horizon: number) => get<Series>("/api/series", { start, end, horizon }),
  horizons: () => get<HorizonPoint[]>("/api/accuracy/horizons"),
  decisionAccuracy: (gate: string) => get<DecisionAccuracy>("/api/accuracy/decisions", { gate }),
};
