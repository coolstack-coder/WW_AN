import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "../api";
import { Card, Kpi, Legend, Status, TooltipBox, useAsync } from "../components/ui";
import { fmtDay, gwh, mw, pct, signed } from "../format";

const kTick = (v: number) => `${(v / 1000).toFixed(1)}`;

export default function AccuracyLab() {
  const [gate, setGate] = useState("09:20");
  const hz = useAsync(api.horizons, []);
  const dec = useAsync(() => api.decisionAccuracy(gate), [gate]);

  const d = dec.data;
  const improvement = d && d.overall.mae && d.overall_corrected.mae
    ? 1 - d.overall_corrected.mae / d.overall.mae : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Accuracy Lab</h2>
          <p>
            How much should you trust the forecast? Every number below is measured over the 31 January 2026 purchase
            decisions (delivery 2 Jan – 1 Feb), using only forecasts that existed at the time.
          </p>
        </div>
        <div className="controls">
          <div className="field">
            <label htmlFor="gate2">Gate closure</label>
            <select id="gate2" value={gate} onChange={(e) => setGate(e.target.value)}>
              <option value="09:20">EPEX 09:20</option>
              <option value="09:50">N2EX 09:50</option>
            </select>
          </div>
        </div>
      </div>

      <Status loading={dec.loading && !d} error={dec.error} />
      {d && (
        <>
          <div className="grid k4">
            <Kpi label="Day-ahead MAE" color="var(--forecast)" value={mw(d.overall.mae)}
              hint={<>{pct(d.overall.nmae, 1)} of mean output · leads {d.lead_range_h[0]}–{d.lead_range_h[1]} h</>} />
            <Kpi label="Systematic bias" color="var(--bad)" value={signed(d.overall.bias)}
              hint="Wind came in below forecast on average" />
            <Kpi label="MAE with rolling bias fix" color="var(--corrected)" value={mw(d.overall_corrected.mae)}
              hint={improvement != null ? <><b className="pos">{pct(improvement)} lower</b> error, no look-ahead</> : undefined} />
            <Kpi label="P10–P90 band coverage" value={pct(d.coverage)} hint="Share of hours where actual fell inside the band (target 80%)" />
          </div>

          <div className="section callout">
            <strong>Key finding.</strong> The day-ahead wind forecast was consistently optimistic in January 2026 –
            on average <strong>{mw(Math.abs(d.overall.bias ?? 0))}</strong> above metered output, and the gap is widest on
            the windiest hours (see “error by wind level”). That pattern is consistent with constraint curtailment of
            wind farms, which the outturn data reflects but the forecast does not. Simply correcting each decision with the
            median error of the previous four weeks cuts the average hourly error by <strong>{pct(improvement)}</strong>.
          </div>

          <div className="grid c2 section">
            <Card title="Error vs forecast horizon" sub="Latest forecast published at least H hours before each hour. Shaded = horizons a day-ahead buyer actually uses.">
              <Status loading={hz.loading && !hz.data} error={hz.error} />
              {hz.data && (
                <>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={hz.data} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#1f2f4d" strokeDasharray="3 6" vertical={false} />
                      <ReferenceArea x1={Math.ceil(d.lead_range_h[0])} x2={Math.min(48, Math.floor(d.lead_range_h[1]))} fill="rgba(45,212,191,.07)" />
                      <XAxis dataKey="horizon_h" stroke="#1f2f4d" ticks={[0, 6, 12, 18, 24, 30, 36, 42, 48]} tickFormatter={(v) => `${v}h`} />
                      <YAxis tickFormatter={kTick} stroke="#1f2f4d" width={40} domain={[0, "auto"]} />
                      <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
                        <TooltipBox title={`horizon ≥ ${label} h`} rows={payload.map((p) => ({ name: String(p.name), value: mw(p.value as number), color: p.color }))} />
                      ) : null} />
                      <Line name="RMSE" dataKey="rmse" stroke="#64748b" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      <Line name="MAE" dataKey="mae" stroke="var(--forecast)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                      <Line name="|bias|" dataKey={(p: { bias?: number }) => Math.abs(p.bias ?? 0)} stroke="var(--bad)" strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                  <Legend items={[
                    { label: "MAE", color: "var(--forecast)" },
                    { label: "RMSE", color: "#64748b" },
                    { label: "|bias|", color: "var(--bad)", dashed: true },
                  ]} />
                </>
              )}
            </Card>

            <Card title="Distribution of day-ahead errors" sub="Actual − forecast, hourly, in GW. Mass left of zero = wind under-delivered.">
              <ResponsiveContainer width="100%" height={282}>
                <BarChart data={d.histogram} margin={{ top: 6, right: 12, left: 0, bottom: 0 }} barCategoryGap={1}>
                  <CartesianGrid stroke="#1f2f4d" strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="from" stroke="#1f2f4d" tickFormatter={kTick} interval={1} />
                  <YAxis stroke="#1f2f4d" width={40} />
                  <ReferenceLine x={0} stroke="#8a9bb8" />
                  <Tooltip cursor={{ fill: "rgba(255,255,255,.03)" }} content={({ active, payload }) => active && payload?.length ? (
                    <TooltipBox title={`${kTick(payload[0].payload.from)} to ${kTick(payload[0].payload.to)} GW`} rows={[{ name: "hours", value: String(payload[0].value) }]} />
                  ) : null} />
                  <Bar dataKey="count" isAnimationActive={false}>
                    {d.histogram.map((b) => <Cell key={b.from} fill={b.from < 0 ? "var(--bad)" : "var(--good)"} fillOpacity={0.75} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Error by hour of delivery day" sub="Mean absolute error per UK hour – raw forecast vs bias-adjusted.">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={d.by_hour} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#1f2f4d" strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="hour" stroke="#1f2f4d" tickFormatter={(h) => `${String(h).padStart(2, "0")}`} interval={2} />
                  <YAxis tickFormatter={kTick} stroke="#1f2f4d" width={40} />
                  <Tooltip cursor={{ fill: "rgba(255,255,255,.03)" }} content={({ active, payload, label }) => active && payload?.length ? (
                    <TooltipBox title={`${String(label).padStart(2, "0")}:00`} rows={payload.map((p) => ({ name: String(p.name), value: mw(p.value as number), color: p.color }))} />
                  ) : null} />
                  <Bar name="Raw MAE" dataKey="mae" fill="var(--forecast)" fillOpacity={0.8} isAnimationActive={false} />
                  <Bar name="Adjusted MAE" dataKey="corrected_mae" fill="var(--corrected)" fillOpacity={0.8} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
              <Legend items={[{ label: "Raw forecast", color: "var(--forecast)" }, { label: "Bias-adjusted", color: "var(--corrected)" }]} />
            </Card>

            <Card title="Error by wind level" sub="Bias grows with forecast output – the windiest hours are where the forecast overshoots most.">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={d.by_level} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#1f2f4d" strokeDasharray="3 6" vertical={false} />
                  <XAxis dataKey="level" stroke="#1f2f4d" />
                  <YAxis tickFormatter={kTick} stroke="#1f2f4d" width={40} />
                  <ReferenceLine y={0} stroke="#8a9bb8" />
                  <Tooltip cursor={{ fill: "rgba(255,255,255,.03)" }} content={({ active, payload, label }) => active && payload?.length ? (
                    <TooltipBox title={`forecast ${label}`} rows={[
                      ...payload.map((p) => ({ name: String(p.name), value: mw(p.value as number), color: p.color })),
                      { name: "hours", value: String(payload[0].payload.n) },
                    ]} />
                  ) : null} />
                  <Bar name="MAE" dataKey="mae" fill="var(--forecast)" fillOpacity={0.8} isAnimationActive={false} />
                  <Bar name="Bias" dataKey="bias" fill="var(--bad)" fillOpacity={0.8} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
              <Legend items={[{ label: "MAE", color: "var(--forecast)" }, { label: "Bias (actual − forecast)", color: "var(--bad)" }]} />
            </Card>
          </div>

          <div className="section">
            <Card title="Every January decision" sub="Daily scorecard. Energy error = (actual − forecast) / forecast over the delivery day.">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Decision</th><th>Delivery</th><th>Forecast</th><th>Actual</th><th>Energy error</th>
                      <th>MAE</th><th>Adjusted MAE</th><th>Band coverage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.daily.map((r) => (
                      <tr key={r.decision_day}>
                        <td>{fmtDay(r.decision_day)}</td>
                        <td>{fmtDay(r.delivery_day)}</td>
                        <td>{gwh(r.forecast_mwh)}</td>
                        <td>{gwh(r.actual_mwh)}</td>
                        <td className={(r.energy_error_pct ?? 0) < 0 ? "neg" : "pos"}>{signed(r.energy_error_pct, "%")}</td>
                        <td>{mw(r.mae)}</td>
                        <td className={(r.corrected_mae ?? 0) < r.mae ? "pos" : "neg"}>{mw(r.corrected_mae)}</td>
                        <td>{pct(r.coverage)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
