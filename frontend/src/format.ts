// Formatting helpers. Everything user-facing is shown in UK local time.

const UK = "Europe/London";

const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: UK, hour: "2-digit", minute: "2-digit" });
const dayTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: UK, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
});
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: UK, weekday: "short", day: "numeric", month: "short" });

export const toMs = (iso: string) => new Date(iso).getTime();
export const fmtTime = (ms: number) => timeFmt.format(ms);
export const fmtDayTime = (ms: number) => dayTimeFmt.format(ms);
export const fmtDay = (isoDate: string) => dayFmt.format(new Date(`${isoDate}T12:00:00Z`));

export const mw = (v: number | null | undefined) =>
  v == null ? "–" : `${Math.round(v).toLocaleString("en-GB")} MW`;

export const gw = (v: number | null | undefined, digits = 1) =>
  v == null ? "–" : `${(v / 1000).toFixed(digits)} GW`;

export const gwh = (mwh: number | null | undefined) =>
  mwh == null ? "–" : `${(mwh / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })} GWh`;

export const pct = (v: number | null | undefined, digits = 0) =>
  v == null ? "–" : `${(v * 100).toFixed(digits)}%`;

export const signed = (v: number | null | undefined, unit = "MW") =>
  v == null ? "–" : `${v > 0 ? "+" : ""}${Math.round(v).toLocaleString("en-GB")}${unit === "%" ? "" : " "}${unit}`;

/** Evenly spaced tick positions (ms) aligned to whole hours of UTC, every `stepH` hours. */
export const hourTicks = (fromMs: number, toMs: number, stepH: number) => {
  const step = stepH * 3600_000;
  const out: number[] = [];
  for (let t = Math.ceil(fromMs / step) * step; t <= toMs; t += step) out.push(t);
  return out;
};

export const addDays = (isoDate: string, n: number) => {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
