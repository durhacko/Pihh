# Encore UI prototype

Interactive mockups for Encore's interface: the stage, the composer and console, and the distributed-systems analysis tools. **Design validation only.** Nothing in `src/` imports this folder, and it changes nothing in `src/`.

The design rationale and the implementation handoff are in [`DESIGN.md`](DESIGN.md). Screenshots of every state are in [`mockups/`](mockups/).

## Run it

Two ways, both offline once installed:

**A. Single file, no install.** Open `dist-single/index.html` in Chrome or Edge. Everything is inlined: three.js, the fonts and the app. Hardware acceleration must be on.

**B. Dev server, for editing.**

```bash
cd prototypes/encore-ui
npm install          # one-off, needs internet
npm run dev          # http://127.0.0.1:5173
npm run typecheck    # strict TS, also type-checks against ../../src/contracts
npm run build:single # rebuilds dist-single/index.html
```

URL options: `?seed=7` sets the seed, `?q=low` forces the lowest render quality, `?demo=1` starts the 90-second script.

## Reviewing it

The **Review** card at the top left is for reviewers only, not part of the product. It holds three walkthroughs matching the brief:

- **A · Stage**: camera, presets, pause and step, a popover opened and closed, metrics, performance mode.
- **B · Compose**: draft, validation, colours, stage preview, pick one drone, inject, watch it spread, the same flow in the console.
- **C · Analyse**: inspect a drone, X-ray, regional kill with ghost slots, jam, divergent versions, stacked comparison, metrics.

Each step has a **Show me** button. It drives the same actions as the dock, the keys and the console. Press `?` for every shortcut.

## What is real and what is mocked

| Part | Source | Status |
|---|---|---|
| Contract types (`WorldSnapshot`, `EnvEvent`, `Belief`, `Observer`, …) | `../../src/contracts` | **Real.** Imported read-only |
| Formations: `expandRecipe`, `composeNext`, `makeScore`, the 5×7 font | `../../src/score` | **Real** |
| Static baseline brain and `steer()` | `../../src/agent` | **Real** |
| World | `src/engine/fixtureWorld.ts` | **Mock.** A copy of main's WP-2a world plus the `PARTITION_*`, `INJECT_SCORE` and `SET_LOSS` events that main still rejects |
| Encore brain | `src/engine/fixtureEncoreBrain.ts` | **Mock.** A compact reading of contract §8 and §9, written so the UI has real HB/SCORE traffic to show. It is not #16 |
| Observer and metrics | `src/engine/fixtureObserver.ts` | **Mock.** The evaluation doc's formulas; `sfMean` and `sfMax` are not computed |

Every mocked surface carries an amber **proto** tag in the UI. Future features carry a dotted **later** tag and do nothing when used.
