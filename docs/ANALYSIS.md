# Analysis – how good is the GB wind forecast for day-ahead buying?

Scope: 31 purchase decisions taken 1–31 January 2026 (delivery 2 Jan – 1 Feb 2026).
Data: Elexon `WINDFOR` (forecast) and `FUELHH` fuel type `WIND` (outturn). All numbers can be reproduced from the
app (Accuracy Lab) or from the API (`/api/accuracy/decisions`, `/api/accuracy/horizons`).

## 1. What the buyer actually sees

`WINDFOR` is published **8 times a day** (02:30, 04:30, 07:30, 09:30, 11:30, 15:30, 18:30, 22:30 UTC). Each run
holds hourly values up to roughly 3 days ahead.

| Auction | Gate closure (UK) | Run used | Lead time to delivery hours |
|---|---|---|---|
| EPEX SPOT GB day-ahead | 09:20 | 07:30 | 16.5 – 39.5 h |
| Nord Pool N2EX day-ahead | 09:50 | 09:30 | 14.5 – 37.5 h |

The extra half hour before the N2EX gate brings in a fresher run, but that only makes a small difference:
MAE goes from 2,023 MW to 1,996 MW.

## 2. Headline accuracy (EPEX gate, 744 delivery hours)

| Metric | Value |
|---|---|
| Mean actual wind output | 11,286 MW |
| MAE | **2,023 MW** (17.9 % of mean output) |
| RMSE | 2,497 MW |
| Bias (actual − forecast) | **−1,746 MW** |
| 80 % of hourly errors within | −4,154 … +426 MW |
| 95th percentile absolute error | 5,268 MW |
| Worst hour | 6,894 MW |

## 3. The forecast is systematically optimistic

- Wind under-delivered against the forecast on **27 of 31** delivery days.
- The bias is almost the same at **0 h horizon (−1,471 MW)** as at 24 h (−1,736 MW). Most of the error therefore
  isn't forecasting skill decaying with time. It's a structural gap between what is forecast and what gets metered.
- The gap grows with wind level: −0.3 GW when the forecast is 4–8 GW, but **−2.8 GW when the forecast is above 16 GW**.
  This pattern is consistent with **constraint curtailment**: on very windy days, transmission limits (mainly
  Scotland → England) mean wind farms get paid to turn down. The metered outturn shows this; the forecast of
  available wind does not.

**Implication for the buyer:** if you plan purely on the published forecast, you're structurally short on windy
days and have to buy back in intraday or balancing markets.

## 4. Error vs horizon

| Horizon ≥ | MAE | Bias | nMAE |
|---|---|---|---|
| 0 h | 1,680 | −1,471 | 14.9 % |
| 4 h | 1,719 | −1,524 | 15.2 % |
| 12 h | 1,791 | −1,595 | 15.9 % |
| 24 h | 1,932 | −1,736 | 17.1 % |
| 36 h | 2,143 | −1,834 | 19.0 % |
| 48 h | 2,301 | −1,801 | 20.5 % |

Accuracy degrades steadily but slowly with horizon (about +13 MW of MAE per extra hour). The day-ahead window
(16–40 h) sits in the middle of this curve.

## 5. A simple, honest fix: rolling bias adjustment

For each decision we take the hourly errors of the previous 28 decisions whose delivery had fully finished
before the decision day, so there's no look-ahead. We then shift the forecast by their median.

| | Raw forecast | Bias-adjusted |
|---|---|---|
| MAE | 2,023 MW | **1,457 MW (−28 %)** |
| Bias | −1,746 MW | −684 MW |

The adjusted forecast beats the raw one on **24 of 31** days. Its P10–P90 band from the same errors contains the
actual in **86 %** of hours, against a nominal 80 %, so it's slightly conservative, which is the safe side for a buyer.

## 6. Days that hurt

| Delivery day | Forecast | Actual | Energy error |
|---|---|---|---|
| Wed 28 Jan | 267 GWh | 139 GWh | **−48 %** |
| Sun 11 Jan | 441 GWh | 324 GWh | −26 % |
| Mon 12 Jan | 464 GWh | 347 GWh | −25 % |

28 January is the stand-out miss. The forecast held up through the day while actual output fell away, and even
the P10 band didn't cover it. This is the kind of event a buyer needs to plan for with a risk margin, not just a
central forecast.

## 7. Recommendations

1. **Don't buy against the raw forecast.** Use the bias-adjusted forecast as the central case.
2. **Size the risk position on P10 wind.** The difference between expected and P10 wind energy is the volume
   exposed to imbalance prices.
3. **Prefer the latest run before gate closure.** Fresher runs help a little; the app always picks the latest one automatically.
4. **Next steps:** a bias model that depends on wind level (or a quantile regression on forecast level and hour),
   a longer back-test across seasons, and adding demand and solar so the app can output a procurement volume directly.
