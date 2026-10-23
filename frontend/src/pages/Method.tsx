import { Meta } from "../api";
import { Card } from "../components/ui";

export default function Method({ meta }: { meta: Meta }) {
  return (
    <>
      <div className="page-head">
        <div>
          <h2>Method</h2>
          <p>Definitions and assumptions behind every number in the app, so the results can be checked and challenged.</p>
        </div>
      </div>
      <Card>
        <div className="prose">
          <h3 style={{ marginTop: 0 }}>Data</h3>
          <p>
            <b>Actuals</b> – Elexon <code>FUELHH</code>, fuel type <code>WIND</code>: metered wind generation per
            30-minute settlement period. If a period is re-published, the latest value wins.
            <br />
            <b>Forecasts</b> – Elexon <code>WINDFOR</code>: national wind generation forecast, hourly values.
            {` ${meta.forecast_runs}`} forecast runs are held, published at {meta.run_times_utc.join(", ")} UTC
            (8 runs a day), each looking up to ~3 days ahead. Rows whose target time is before the publish time are discarded.
          </p>

          <h3>Scope</h3>
          <p>
            Purchase decisions taken {meta.decision_start} to {meta.decision_end}, i.e. delivery days
            {` ${meta.delivery_start}`} to {meta.delivery_end}. December 2025 is loaded as warm-up history so that the
            first January decision already has four weeks of past errors to learn from.
          </p>

          <h3>Decision forecast</h3>
          <p>
            A decision on day <i>D</i> buys power for UK delivery day <i>D+1</i> (00:00–24:00 Europe/London). The
            forecast used is the latest run published <b>before the auction gate closure</b> on day <i>D</i>:
            09:20 for the EPEX SPOT GB day-ahead auction or 09:50 for Nord Pool N2EX. In January, that is normally
            the 07:30 run (EPEX) or the 09:30 run (N2EX), giving lead times of roughly 16–40 hours.
          </p>

          <h3>Horizon view (Forecast Explorer)</h3>
          <p>
            For every target hour <i>T</i> and a chosen horizon <i>H</i>, the forecast shown is the latest one with
            {" "}<code>publishTime ≤ T − H</code>. This is how the accuracy-versus-horizon curve is built.
          </p>

          <h3>Error and metrics</h3>
          <p>
            Error = <b>actual − forecast</b> in MW, matched on the hour start (hourly forecast vs the half-hour
            settlement period starting at the same time). Negative error means wind under-delivered and the buyer is
            short. MAE, RMSE and bias are reported in MW; nMAE divides MAE by mean actual output. MAPE is deliberately
            avoided because it explodes on calm hours.
          </p>

          <h3>Uncertainty band and bias adjustment</h3>
          <p>
            For each decision, the P10, P50 and P90 of the hourly errors of the previous
            {` ${meta.error_window_days}`} decisions are added to the forecast. Only decisions whose delivery day had already ended
            before the current decision day are used (a decision on <i>d</i> is admitted only if <i>d ≤ D − 2</i>), so there is
            no look-ahead. The P50 shift is the “bias-adjusted” forecast; P10/P90 form the band. The P10 energy is the sum of the
            hourly P10s, which is a conservative figure.
          </p>

          <h3>Known limitations</h3>
          <ul>
            <li>Wind only. No demand, solar or price data, by design of the pilot.</li>
            <li>One month of evaluation is a small sample; the band and bias will move with the season.</li>
            <li>FUELHH covers transmission-metered wind; embedded wind behind the meter is not in either series.</li>
            <li>The error band ignores wind level; a level-aware or quantile model is the obvious next step.</li>
          </ul>
        </div>
      </Card>
    </>
  );
}
