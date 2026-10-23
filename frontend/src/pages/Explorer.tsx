import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, Meta } from "../api";
import { Card, Kpi, Legend, Status, TooltipBox, useAsync } from "../components/ui";
import { fmtDayTime, gw, mw, pct, signed, toMs } from "../format";

const dayTick = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });

/** Debounce slider drags so we don't fire a request per pixel. */
function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export default function Explorer({ meta }: { meta: Meta }) {
  const [start, setStart] = useState("2026-01-08");
  const [end, setEnd] = useState("2026-01-21");
  const [horizon, setHorizon] = useState(24);
  const h = useDebounced(horizon);

  const { data, loading, error } = useAsync(() => api.series(start, end, h), [start, end, h]);

  const rows = useMemo(() => {
    if (!data) return [];
    const m = new Map<number, Record<string, number>>();
    data.actual.forEach((a) => m.set(toMs(a.start_time), { t: toMs(a.start_time), actual: a.actual }));
    data.forecast.forEach((f) => {
      const t = toMs(f.start_time);
      m.set(t, { ...(m.get(t) ?? { t }), forecast: f.forecast });
    });
    return [...m.values()].sort((a, b) => a.t - b.t);
  }, [data]);

  const mm = data?.metrics;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Forecast Explorer</h2>
          <p>
            Pick a window and a horizon. For every hour we plot the latest forecast that had been published at least
            <b> {horizon} h</b> earlier – the view you would have had if you’d looked {horizon} hours ahead.
          </p>
        </div>
        <div className="controls">
          <div className="field">
            <label htmlFor="start">From</label>
            <input id="start" type="date" value={start} min={meta.delivery_start} max={end}
              onChange={(e) => e.target.value && setStart(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="end">To</label>
            <input id="end" type="date" value={end} min={start} max={meta.delivery_end}
              onChange={(e) => e.target.value && setEnd(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="h">Forecast horizon · {horizon} h</label>
            <input id="h" type="range" min={0} max={48} step={1} value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))} />
          </div>
        </div>
      </div>

      <Status loading={loading && !data} error={error} />
      {data && mm && (
        <>
          <div className="grid k4">
            <Kpi label="Mean absolute error" value={mw(mm.mae)} hint={<>{pct(mm.nmae, 1)} of mean wind output</>} />
            <Kpi label="Bias (actual − forecast)" value={signed(mm.bias)}
              hint={(mm.bias ?? 0) < 0 ? "Forecast systematically too high" : "Forecast systematically too low"} />
            <Kpi label="RMSE" value={mw(mm.rmse)} hint="Penalises the big misses more" />
            <Kpi label="80% of errors within" value={`${gw(mm.p10)} … ${gw(mm.p90)}`} hint={<>{mm.n} hourly points</>} />
          </div>

          <div className="section">
            <Card title="Actual vs forecast wind generation" sub="Actuals are half-hourly (FUELHH); forecasts are hourly (WINDFOR).">
              <ResponsiveContainer width="100%" height={400}>
                <ComposedChart data={rows} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#1f2f4d" strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]}
                    tickFormatter={(v) => dayTick.format(v)} stroke="#1f2f4d" tickCount={10} />
                  <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}`} stroke="#1f2f4d" width={44}
                    label={{ value: "GW", position: "insideTopLeft", fill: "#5b6b88", fontSize: 11, dy: -8 }} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0].payload as Record<string, number>;
                      return (
                        <TooltipBox title={fmtDayTime(label as number)} rows={[
                          ...(p.actual != null ? [{ name: "Actual", value: mw(p.actual), color: "var(--actual)" }] : []),
                          ...(p.forecast != null ? [{ name: `Forecast (≥${h} h)`, value: mw(p.forecast), color: "var(--forecast)" }] : []),
                          ...(p.actual != null && p.forecast != null ? [{ name: "Error", value: signed(p.actual - p.forecast) }] : []),
                        ]} />
                      );
                    }}
                  />
                  <Line dataKey="actual" stroke="var(--actual)" strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} />
                  <Line dataKey="forecast" stroke="var(--forecast)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <Legend items={[
                { label: "Actual outturn", color: "var(--actual)" },
                { label: `Latest forecast published ≥ ${h} h before`, color: "var(--forecast)" },
              ]} />
            </Card>
          </div>
        </>
      )}
    </>
  );
}
