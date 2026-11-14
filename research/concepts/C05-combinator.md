# C05: Combinator, trading strategies built by composing parts

> Status: candidate. Source: bootstrap research agent (2026-11-14). Confidence: low.

**One-liner:** Strategies are built from typed building blocks (signal → filter → position sizing → risk overlay). A search composes primitives into new strategies and validates them on data they weren't fitted to.

| Field | Content |
|---|---|
| Audience | Quant researchers and students |
| Why Composition | A strategy is a composition of functions, a portfolio is a composition of positions, and risk overlays compose |
| Demo | Drag 3 blocks and the equity curve updates instantly. Hit "evolve": genetic programming builds about 1,000 strategies and plots the trade-off between return and drawdown. Replay the winner on a held-out crash period, with a chart attributing profit to each block. |
| Mechanism | Vectorised pandas/numba backtests, a typed DSL, typed genetic programming (DEAP), Shapley attribution, React Flow UI |
| Dependencies | Price data: pre-bundle CSVs (yfinance rate limits) |
| Prior art | Composer (no-code "Symphonies"), QuantConnect. **We differ by** a typed algebra, automated search, per-block attribution, and an overfitting check (deflated Sharpe). |
| MVP | 10 primitives, sequential and parallel blocks, backtest, tree view, attribution |
| Stretch | GP search, deflated Sharpe, synthetic market-regime generator |
| Fallback | Bundled CSVs. Lead with out-of-sample results. |
| Effort | M |
| Risks | Least visual. Quant judges will probe for look-ahead bias. |
| Sponsor fit | QRT (**unverified**) |
