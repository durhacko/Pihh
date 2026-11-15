# QA: performance and screenshots

How to measure the app and capture the UI states for issue [#94](https://github.com/durhacko/Pihh/issues/94), and how to read the numbers. The harness is `scripts/perf/run.mjs`. It drives the real built app in headless Chrome, so the final evidence takes minutes once the new shell (#92) lands. The latest run's numbers are in [`assets/qa/perf.md`](../../assets/qa/perf.md), the raw data in `assets/qa/perf.json`.

## Run it

You need Node 22.12+, the repo's `npm ci`, and a Chrome or Chromium on the machine. Nothing is added to `package.json`. The harness looks for a browser in this order:

1. `$CHROME_PATH`;
2. Playwright's cache (`~/.cache/ms-playwright`);
3. Puppeteer's cache (`~/.cache/puppeteer`);
4. the usual system paths on Linux, macOS and Windows.

If there is none, `npx playwright install chromium` downloads one into Playwright's cache. That needs internet once.

```bash
node scripts/perf/run.mjs              # build, serve on 127.0.0.1:4173, measure; writes assets/qa/perf.{json,md}
node scripts/perf/run.mjs --shots      # ... and capture the screenshot states (about 10 minutes in software rendering)
node scripts/perf/run.mjs --shots-only # screenshots only; writes assets/qa/shots.{json,md}
node scripts/perf/run.mjs --gl probe   # which WebGL renderer each graphics mode gets on this machine
```

| Option | Default | Meaning |
|---|---|---|
| `--gl auto\|swiftshader\|vulkan\|egl` | `auto` | Graphics path: `auto` lets Chrome use a GPU if it finds one, else SwiftShader |
| `--url <url>` | (build and serve) | Measure an app that is already running, e.g. `npm run dev` |
| `--seconds N` / `--warmup N` | 10 / 6 | Measured window and warm-up per scenario |
| `--no-sim` | | Skip the Node simulation benchmark |
| `--only <state,…>` | (all) | Screenshot only these states, e.g. `--shots-only --only xray,jam` |

The harness works with both app shells: the stage-first shell (#113) and the earlier layout.

On Windows, run the app yourself (`npm.cmd run build`, then `npm.cmd run preview`) and pass `--url http://127.0.0.1:4173/`. On Windows the harness cannot reliably stop a preview server it started itself.

## What is measured

The harness keeps these apart and never mixes them:

- **Render fps.** The number of `requestAnimationFrame` callbacks per real second, measured in the page over the window. The frame-time percentiles and the count of frames longer than 50 ms come from the same deltas. "App readout fps" is the app's own counter, shown as a cross-check. It is read from the readout's `data-fps`: `.readout` at the top right in the stage-first shell, `.frame-readout` at the bottom right before it.
- **Sim ticks/s.** The change in `window.encore.tick()` per real second over the same window. The target is **20 ticks/s at 1× speed** (`DT` = 50 ms). The app's frame loop runs at most 5 ticks per frame and drops the backlog after a 0.1 s frame (`createFrameLoop`). So when frames are slow, the simulation itself falls behind real time. That shows up here as fewer than 20 ticks/s, and it is a different failure from a low frame rate.
- **Scenarios.** Single view, single view with X-ray on (key `X`), split view (`?split=1`), and split with X-ray. All use seed 101 at 1440×900.
- **Node simulation cost** (`scripts/perf/simBench.ts`, run with `npx tsx`). The mean, p50, p95 and max time of one `worlds.stepBoth()`: both worlds and both observers, exactly what the app does per tick, with no rendering. It is measured at **100 and 200 drones**, with the static brain and with the real Encore brain in the Encore arm. "Max ticks/s" is 1000 / mean: the simulation's ceiling on this CPU with nothing else running.
- **Step time inside the browser** is not exposed by the app, so the harness does not report it. The Node numbers are the step cost; the browser numbers are the end result.
- **100 vs 200 drones in the browser is not measurable today.** The app has no roster option (`createWorlds` defaults to 200 and `main.ts` reads only `seed`, `split` and `arm`). Comparing them in the browser needs a read-only URL option such as `?n0=100` in `main.ts` (#92's file).
- **Scripted demo duration.** Measured only when the demo is present (#27). The harness reports "not in this build" otherwise.

### Software rendering is never a GPU number

The harness reads the WebGL renderer string. If it names SwiftShader, llvmpipe or another software rasteriser, the run is marked **software**, and the report says its fps are not a GPU or demo-laptop number. In WSL every mode is software today (`--gl probe`: SwiftShader by default, Mesa llvmpipe through Vulkan). WSL's GPU device does not reach headless Chrome. Software fps say how the CPU path copes; they are a floor for this machine, not the experience on the demo laptop.

## Targets

From [system architecture §6](../design/system-architecture.md#6-scale-and-performance-budget), for both worlds together on a team laptop:

| | Drones | Render | Simulation |
|---|---|---|---|
| **Floor** | 100 | 30 fps | 20 Hz, no backlog dropped |
| **Target** | 200 | 60 fps | 20 Hz |

A run meets a line only if both its render fps and its sim ticks/s meet it, on hardware rendering. If the demo laptop is below the floor, apply the existing quality fallback ([architecture §6](../design/system-architecture.md#6-scale-and-performance-budget): fewer drawn radio sparks, then no glow, then a lower drone-count preset; [risk 7](../planning/decisions-and-risks.md#risks): toggle the view instead of split). Record which step was needed.

## Screenshots

`--shots` captures each state in issue #94 at **1440×900** and **1280×720** into `assets/qa/<width>x<height>/<state>.png`. The states are:
- default stage, X-ray, split view;
- failure: a region around drone 100 killed, 12 s later;
- jam: drone 100 selected by a click, then `J`;
- active injection and version divergence: `I` and belief colours `C`, the latter with a jam first;
- inspector, composer, console, timeline, scripted demo.

A state is captured only if the feature is really on screen. The check runs after the setup step and needs a visible element, so a module that is loaded but not connected (the inspector stays hidden until `main.ts` connects it) is reported as "not shown in this build", not photographed. Each capture records the tick and what the app itself says about its brains. In the earlier layout that is the badge at the top right. In the stage-first shell it is the Metrics popover's "Brains" row; the harness opens it with M after the screenshot, reads it and closes it, so the picture is not affected. A screenshot taken while both arms run the static brain says so, and it shows no repair and no adoption, because none happens.

The PNGs are git-ignored (`assets/qa/.gitignore`): they are large and take minutes to regenerate. To keep one as evidence, run `git add -f` on that file.

## Human steps (an agent cannot do these)

1. **The demo-laptop measurement.** On the presentation laptop, on mains power, open the production build in the browser used for judging, with hardware acceleration on. Read the app's readout (rendered fps and tick) in single view and in split view, with and without X-ray, for about 30 s each. Alternatively, run the harness natively on that laptop with `--url` (not in WSL) and check that its report says **hardware**. Record the results below.
2. **Look at the screenshots** before using any of them, and choose which to commit or put on Devpost.
3. **Time the scripted demo** in a real browser once #27 is merged, if the harness cannot.

## Demo-laptop record

| Date / build | Laptop, browser, GPU | Single view fps, ticks/s | Split fps, ticks/s | With X-ray | Quality step needed | By |
|---|---|---|---|---|---|---|
| not measured yet | | | | | | |
