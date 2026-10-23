import { useMemo, useState } from "react";
import {
  Area, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, DailyDecision, Decision, Meta } from "../api";
import { Card, Kpi, Legend, Status, TooltipBox, useAsync } from "../components/ui";
import { addDays, fmtDay, fmtDayTime, fmtTime, gw, gwh, hourTicks, mw, pct, signed, toMs } from "../format";

const tickH = (ms: number) => fmtTime(ms);
const tickGW = (v: number) => `${(v / 1000).toFixed(0)} GW`;
const dayTicks = (rows: { t?: unknown }[]) =>
  rows.length ? hourTicks(rows[0].t as number, rows[rows.length - 1].t as number, 3) : [];

function DayStrip({ meta, daily, value, onChange }: {
  meta: Meta; daily?: DailyDecision[]; value: string; onChange: (d: string) => void;
}) {
  const days: string[] = [];
  for (let d = meta.decision_start; d <= meta.decision_end; d = addDays(d, 1)) days.push(d);
  const byDay = new Map(daily?.map((d) => [d.decision_day, d]));
  return (
    <div className="daystrip" role="tablist" aria-label="Decision day">
      {days.map((d) => {
        const err = byDay.get(d)?.energy_error_pct;
        // bar colour hints at how the forecast fared that day (red = wind under-delivered)
        const color = err == null ? "transparent" : err < -15 ? "var(--bad)" : err > 10 ? "var(--good)" : "var(--faint)";
        return (
          <button key={d} className={`daycell ${d === value ? "active" : ""}`} onClick={() => onChange(d)} title={fmtDay(d)}>
            {Number(d.slice(8))}
            <span className="bar" style={{ background: color }} />
          </button>
        );
      })}
    </div>
  );
}

function DeliveryChart({ data, reveal }: { data: Decision; reveal: boolean }) {
  const rows = useMemo(() => {
    const m = new Map<number, Record<string, unknown>>();
    for (const h of data.hours) {
      m.set(toMs(h.start_time), {
        t: toMs(h.start_time), forecast: h.forecast, corrected: h.corrected,
        band: h.low != null && h.high != null ? [h.low, h.high] : undefined,
      });
    }
    if (reveal) {
      for (const a of data.actuals_halfhourly) {
        const t = toMs(a.start_time);
        m.set(t, { ...(m.get(t) ?? { t }), actual: a.actual });
      }
    }
    return [...m.values()].sort((a, b) => (a.t as number) - (b.t as number));
  }, [data, reveal]);

  return (
    <>
      <ResponsiveContainer width="100%" height={360}>
        <ComposedChart data={rows} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#1f2f4d" strokeDasharray="3 6" vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={tickH}
            ticks={dayTicks(rows)} stroke="#1f2f4d" />
          <YAxis tickFormatter={tickGW} stroke="#1f2f4d" width={52} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as Record<string, number | number[] | undefined>;
              const band = p.band as number[] | undefined;
              return (
                <TooltipBox title={fmtDayTime(label as number)} rows={[
                  ...(p.forecast != null ? [{ name: "Forecast", value: mw(p.forecast as number), color: "var(--forecast)" }] : []),
                  ...(band ? [{ name: "P10 – P90", value: `${gw(band[0])} – ${gw(band[1])}` }] : []),
                  ...(p.corrected != null ? [{ name: "Bias-adjusted", value: mw(p.corrected as number), color: "var(--corrected)" }] : []),
                  ...(p.actual != null ? [{ name: "Actual", value: mw(p.actual as number), color: "var(--actual)" }] : []),
                ]} />
              );
            }}
          />
          <Area dataKey="band" stroke="none" fill="var(--band)" connectNulls isAnimationActive={false} />
          <Line dataKey="forecast" stroke="var(--forecast)" strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
          <Line dataKey="corrected" stroke="var(--corrected)" strokeWidth={1.8} strokeDasharray="6 5" dot={false} connectNulls isAnimationActive={false} />
          {reveal && <Line dataKey="actual" stroke="var(--actual)" strokeWidth={2.2} dot={false} connectNulls isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
      <Legend items={[
        { label: "Forecast available at gate closure", color: "var(--forecast)" },
        { label: "P10 – P90 empirical error band", color: "var(--band)", area: true },
        { label: "Bias-adjusted (median error)", color: "var(--corrected)", dashed: true },
        ...(reveal ? [{ label: "Actual outturn", color: "var(--actual)" }] : []),
      ]} />
    </>
  );
}

function VintageChart({ data }: { data: Decision }) {
  const { rows, keys } = useMemo(() => {
    const m = new Map<number, Record<string, number>>();
    const keys = data.vintages.map((v) => v.publish_time);
    data.vintages.forEach((v) => v.points.forEach((p) => {
      const t = toMs(p.start_time);
      m.set(t, { ...(m.get(t) ?? { t }), [v.publish_time]: p.forecast });
    }));
    return { rows: [...m.values()].sort((a, b) => a.t - b.t), keys };
  }, [data]);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={rows} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#1f2f4d" strokeDasharray="3 6" vertical={false} />
        <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={tickH} stroke="#1f2f4d" ticks={dayTicks(rows)} />
        <YAxis tickFormatter={tickGW} stroke="#1f2f4d" width={52} />
        <Tooltip
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox title={fmtDayTime(label as number)} rows={payload.map((p) => ({
                name: `run ${fmtDayTime(toMs(p.dataKey as string))}`, value: mw(p.value as number), color: p.color,
              }))} />
            ) : null
          }
        />
        {keys.map((k, i) => (
          <Line key={k} dataKey={k} dot={false} isAnimationActive={false}
            stroke="var(--forecast)" strokeOpacity={0.15 + (0.85 * (i + 1)) / keys.length}
            strokeWidth={i === keys.length - 1 ? 2.5 : 1.2} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export default function DecisionDesk({ meta }: { meta: Meta }) {
  const [day, setDay] = useState("2026-01-15");
  const [gate, setGate] = useState(meta.gates[0].value);
  const [reveal, setReveal] = useState(false);

  const { data, loading, error } = useAsync(() => api.decision(day, gate), [day, gate]);
  const acc = useAsync(() => api.decisionAccuracy(gate), [gate]);

  const s = data?.summary;
  const h = data?.hindsight;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Decision Desk</h2>
          <p>
            Exactly what the trading team sees at gate closure on the decision day: the latest wind forecast for
            tomorrow, how much of it you can rely on, and – after the fact – how it actually turned out.
          </p>
        </div>
        <div className="controls">
          <div className="field">
            <label htmlFor="gate">Auction gate closure</label>
            <select id="gate" value={gate} onChange={(e) => setGate(e.target.value)}>
              {meta.gates.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </div>
          <button className={`toggle ${reveal ? "on" : ""}`} onClick={() => setReveal((r) => !r)}>
            <span className="dot" /> {reveal ? "Hindsight on" : "Reveal actuals"}
          </button>
        </div>
      </div>

      <DayStrip meta={meta} daily={acc.data?.daily} value={day} onChange={setDay} />

      <Status loading={loading && !data} error={error} />
      {data && s && (
        <>
          <div className="grid k4">
            <Kpi label={`Wind forecast · ${fmtDay(data.delivery_day)}`} color="var(--forecast)"
              value={gwh(s.forecast_mwh)}
              hint={<>Range {gw(s.min_forecast_mw)} – {gw(s.peak_forecast_mw)} through the day</>} />
            <Kpi label="Wind you can count on (P10)" color="var(--band)"
              value={gwh(s.conservative_mwh)}
              hint="Forecast plus the P10 of recent errors – outturn beat this level in ~9 of 10 past hours" />
            <Kpi label="Bias-adjusted expectation" color="var(--corrected)"
              value={gwh(s.corrected_mwh)}
              hint={data.band ? <>Forecast shifted by recent median error ({signed(data.band.p50)})</> : "Not enough history"} />
            <Kpi label="Forecast run used"
              value={<span className="mono" style={{ fontSize: 22 }}>{data.run_publish_time ? fmtDayTime(toMs(data.run_publish_time)) : "–"}</span>}
              hint={<>Published {data.run_age_h} h before the {data.gate} gate · leads of {data.hours[0]?.lead_h}–{data.hours.at(-1)?.lead_h} h</>} />
          </div>

          <div className="section">
            <Card
              title={`Delivery day ${fmtDay(data.delivery_day)} – hourly wind generation`}
              sub={data.band
                ? <>Band built from {data.band.n.toLocaleString()} hourly errors of the same decision process between {fmtDay(data.band.from)} and {fmtDay(data.band.to)} – only data that was already known at gate closure.</>
                : "Not enough history yet to quantify uncertainty."}
            >
              <DeliveryChart data={data} reveal={reveal} />
            </Card>
          </div>

          {reveal && h && (
            <div className="grid k4 section">
              <Kpi label="Actual wind energy" color="var(--actual)" value={gwh(s.actual_mwh)}
                hint={s.actual_mwh != null ? <>{signed(((s.actual_mwh - s.forecast_mwh) / s.forecast_mwh) * 100, "%")} vs forecast</> : undefined} />
              <Kpi label="Mean absolute error" value={mw(h.mae)} hint={<>Bias {signed(h.bias)} · worst hour {mw(h.max_abs)}</>} />
              <Kpi label="MAE after bias adjustment" color="var(--corrected)" value={mw(h.corrected_mae)}
                hint={h.mae && h.corrected_mae ? <>{signed(((h.corrected_mae - h.mae) / h.mae) * 100, "%")} vs raw forecast</> : undefined} />
              <Kpi label="Hours inside P10–P90 band" value={pct(h.coverage)} hint="Target is ~80% for a well-calibrated band" />
            </div>
          )}

          <div className="grid c2 section">
            <Card title="How the forecast evolved" sub="Every forecast run in the 48 h before gate closure for this delivery day. Brighter = more recent.">
              <VintageChart data={data} />
            </Card>
            <Card title="What this means for the purchase" sub="Turning the forecast into a buying position.">
              <div className="prose" style={{ fontSize: 14 }}>
                <p style={{ marginTop: 0 }}>
                  Planning against the raw forecast assumes <b>{gwh(s.forecast_mwh)}</b> of wind tomorrow. History says
                  wind has been landing <b>{data.band ? signed(data.band.p50) : "–"}</b> per hour versus this forecast,
                  so the central expectation is <b>{gwh(s.corrected_mwh)}</b>.
                </p>
                <p>
                  A risk-averse position covers demand assuming only the P10 wind level –
                  {" "}<b>{gwh(s.conservative_mwh)}</b>. The gap between the two
                  {s.corrected_mwh != null && s.conservative_mwh != null && <> (<b>{gwh(s.corrected_mwh - s.conservative_mwh)}</b>)</>}
                  {" "}is the volume to cover with additional day-ahead purchases or to leave exposed to imbalance prices.
                </p>
                <p className="muted" style={{ marginBottom: 0 }}>
                  Hourly P10s are summed, which is conservative: forecast errors within a day are correlated but not perfectly.
                </p>
              </div>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
