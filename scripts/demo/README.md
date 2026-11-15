# Backup recording of the scripted demo

`record.mjs` records the real 90-second scripted demo ([DEMO_PLAN](../../docs/demo/DEMO_PLAN.md#known-good-demo-path)) from the built app in headless Chrome. The result is a fallback for the human backup video (issue [#131](https://github.com/durhacko/Pihh/issues/131)). It is an unedited recording of the live simulation:
- it is not sped up and not cut;
- frames are not interpolated;
- the captions are the app's own.

## Run it

You need Node 22.12+, `npm ci`, a Chrome or Chromium (found as in [QA.md](../../docs/demo/QA.md#run-it)), and `ffmpeg` on the PATH (or `$FFMPEG_PATH`).

**Use a hardware GL path.** The script refuses to record if WebGL is a software rasteriser (SwiftShader, llvmpipe). Pass `--allow-software` to record anyway. In WSL every graphics mode is software, so on a Windows laptop with the repo in WSL:

```bash
# 1. In WSL: build and serve the app.
npm run build
npx vite preview --host 127.0.0.1 --port 4174 --strictPort
```

```powershell
# 2. In Windows PowerShell: Windows Node drives Windows Chrome, which gets the GPU.
node "\\wsl.localhost\Ubuntu-24.04\home\<you>\...\scripts\demo\record.mjs" --url http://127.0.0.1:4174/
```

On Linux or macOS with a GPU, `node scripts/demo/record.mjs` builds, serves on 127.0.0.1:4174 and records in one step.

| Option | Default | Meaning |
|---|---|---|
| `--url <url>` | (build and serve) | Record an app that is already served |
| `--gl auto\|swiftshader\|vulkan\|egl` | `auto` | Chrome graphics path, as in the perf harness |
| `--out <dir>` | `scripts/demo/out` | Where the video and sidecar go (git-ignored) |
| `--fps N` | 60 | Output frame rate of the MP4 |
| `--quality N` | 70 | Screencast JPEG quality. At 90 the test laptop captured 38 fps instead of 57 |
| `--tail N` | 3 | Seconds kept after the end caption |
| `--allow-software` | off | Record even on software WebGL |
| `--keep-frames` | off | Keep the captured JPEG frames |

A run takes about 2 minutes: 1 s before the show, about 93 s of show, the tail, then encoding. Exit code 0 means the demo finished with no problem reported. Exit code 1 means a beat reported a problem, the page threw, the frame loop stopped, or the demo did not finish. Check the printed list, and do not use that recording as the canonical demo.

## What it does

1. It opens `?seed=101` at 1920×1080 with the default roster (n0 = 200). It checks that the page has 200 drones and the app shell's Show button.
2. It starts a CDP screencast, waits 1 s, and presses **D**.
3. It records until the app says the demo has finished: the Show button is released and the end caption ("End of the 90-second demo") is on screen. There is no fixed sleep. A stop before the end, a stopped frame loop, or more than 240 s fails the run.
4. Each frame keeps the time Chrome painted it. ffmpeg holds each frame until the next one was painted. Converting to a constant 60 fps repeats or drops whole frames at their real times and never blends them.

The script only reads the page: the DOM, `window.encore.tick()` and the readout's `data-*` attributes. Its only input to the app is the single **D** key press.

## The sidecar (`<video>.json`)

| Field | What it is |
|---|---|
| `result`, `problems` | `OK`, or each problem: error toasts ("Demo: …"), caption sub-lines with "problem", page errors, or a demo that did not finish |
| `machine.gl`, `machine.rendering` | The WebGL renderer string, and whether it is hardware |
| `app` | Git revision of the checkout, and whether `src/` had uncommitted changes |
| `demo` | Started, finished, final tick, the end caption, and wall seconds from D to the end. Wall time includes the script's 0.5× section, so it is about 93 s for 90 s of show |
| `renderFps` | The app's frame rate during the recording. It comes from requestAnimationFrame deltas: mean, frame-time percentiles, frames over 33, 50 and 100 ms, and frames in the worst and best whole second. `appReadout` is the app's own fps counter |
| `captureFps` | The same statistics for the frames that reached the video. **This, not the render rate, is how smooth the video is** |
| `simulation` | Ticks per wall second during the show. It should be about 19.4 including the 0.5× section, or 20 at 1×. Also alive counts at the end |
| `captions` | Each caption with the tick and time at which it first appeared (sampled every 250 ms) |
| `toasts`, `samples` | Every toast, and the 250 ms samples of tick, fps, alive counts, Show state and caption sub-line |

## Known limits

- **Capture is less smooth than the app.** On the Intel Arc 140T laptop, the app rendered at 108 fps mean while recording. The screencast delivered 57 fps mean, with 23 gaps over 100 ms (the longest 250 ms) and a worst second of 19 frames. Those gaps are visible as brief stutters. They are a limit of the capture, not of the simulation, which kept its 20 Hz clock. The sidecar reports them for every run.
- Recording costs frame rate. The same laptop renders 180+ fps without a screencast.
- Windows only: cdp.mjs's `launch()` can read `DevToolsActivePort` while Chrome still holds it locked (EBUSY), and `close()` can fail to delete the profile (EPERM). `record.mjs` retries that read itself and treats the cleanup failure as a warning. The proper fix belongs in `scripts/perf/cdp.mjs`.
- No audio track.
