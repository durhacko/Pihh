#!/usr/bin/env node
// scripts/demo/record.mjs
// Issue #131: an automated backup recording of the scripted 90-second demo, from the real built app in headless Chrome.
//
//   node scripts/demo/record.mjs                       build, serve on 127.0.0.1:4174, record, encode
//   node scripts/demo/record.mjs --url http://127.0.0.1:4174/   record an app that is already served (needed on Windows)
//   options: --gl auto|swiftshader|vulkan|egl (default auto) · --out <dir> (default scripts/demo/out)
//            --fps N (output frame rate, default 60) · --quality N (screencast JPEG, default 70) · --tail N (seconds kept after the end caption, default 3)
//            --allow-software (record even if WebGL is a software rasteriser) · --keep-frames
//
// What it does: opens ?seed=101 at 1920×1080 (n0 is the default 200), starts a CDP screencast, presses D, and records
// until the app itself says the demo has finished (the Show button is released and the end caption is on screen).
// Every captured frame keeps the time Chrome painted it, and ffmpeg lays the frames out on those times: no speed-up, no
// cut, no interpolation. Converting to a constant frame rate only repeats or drops whole frames at their real times.
// The sidecar JSON logs tick, render fps, capture fps, every caption as it appeared and every problem the demo reported.
// Exit code 1 if any beat reported a problem, the page threw, the frame loop stopped or the demo did not finish.
// How to run it and read the sidecar: scripts/demo/README.md.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, openPage, sleep } from '../perf/cdp.mjs';

// Windows: cdp.mjs's launch() reads DevToolsActivePort as soon as it exists, while Chrome may still hold it locked.
// The read then throws EBUSY and the orphaned Chrome keeps Node alive. Until launch() retries itself, retry that one
// read here (bounded: 100 × 50 ms). Only reads of a file named DevToolsActivePort are affected.
{
  const read = fs.readFileSync;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  fs.readFileSync = function readWithRetry(path, ...rest) {
    if (!String(path).endsWith('DevToolsActivePort')) return read.call(this, path, ...rest);
    for (let i = 0; ; i++) {
      try { const text = read.call(this, path, ...rest); if (String(text).trim() || i >= 100) return text; } catch (error) { if (error.code !== 'EBUSY' || i >= 100) throw error; }
      Atomics.wait(pause, 0, 0, 50);
    }
  };
  syncBuiltinESMExports();
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const option = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const GL = option('gl', 'auto');
const OUT = resolve(ROOT, option('out', join('scripts', 'demo', 'out')));
const FPS = Number(option('fps', 60));
const TAIL = Number(option('tail', 3));
const QUALITY = Number(option('quality', 70));   // screencast JPEG: at 90 the Arc 140T captured 38 fps mean, at 70 it captured 57
const PORT = 4174;   // not the perf harness's 4173, so both can run
const VIEWPORT = { width: 1920, height: 1080 };
const SEED = 101;
const END_TICK = 1800;   // DEMO_TICKS.END in src/app/ui/DemoScript.ts
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;
const WINDOWS = platform() === 'win32';
const npm = WINDOWS ? 'npm.cmd' : 'npm';
const SHELL = { shell: WINDOWS };

// ------------------------------------------------------------------------------------ the page side

const WAIT_FOR_APP = `new Promise((resolve, reject) => {
  const start = performance.now();
  (function poll() {
    if (window.encore && typeof window.encore.tick === 'function' && window.encore.tick() > 0) return resolve(true);
    const error = document.querySelector('.error')?.textContent;
    if (error) return reject(new Error(error));
    if (performance.now() - start > 30000) return reject(new Error('window.encore did not appear within 30 s'));
    setTimeout(poll, 100);
  })();
})`;

const GL_INFO = `(() => {
  const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
  if (!gl) return { webgl: false };
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return { webgl: true, version: gl.getParameter(gl.VERSION),
    vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
})()`;

// Read-only probes of what the app shows. They never change the simulation.
const PROBES = `
  const showButton = () => document.querySelector('button[aria-label="Show (D)"][aria-pressed]');   // the dock's Show button (Dock.ts)
  const captionParts = () => {
    const el = document.querySelector('.caption');
    if (!el || el.hidden) return { caption: '', sub: '' };
    const sub = el.querySelector('small')?.textContent ?? '';
    return { caption: (el.textContent ?? '').slice(0, (el.textContent ?? '').length - sub.length).trim(), sub };
  };
  const readout = () => document.querySelector('.readout');
`;

/** Installs a recorder in the page: rAF deltas, a 250 ms sample of the app's state, every toast as it is added. */
const INSTALL = `(() => {
  ${PROBES}
  const rec = window.__demoRecord = { t0: performance.now(), deltas: [], samples: [], toasts: [], captions: [] };
  let last = performance.now();
  requestAnimationFrame(function frame(now) { rec.deltas.push(now - last); last = now; if (!rec.done) requestAnimationFrame(frame); });
  let lastCaption = null;
  const sample = () => {
    const { caption, sub } = captionParts();
    const r = readout();
    const s = { t: Math.round(performance.now() - rec.t0), tick: window.encore.tick(), appFps: r?.dataset.fps ? Number(r.dataset.fps) : null,
      aliveEncore: r?.dataset.aliveEncore ? Number(r.dataset.aliveEncore) : null, aliveStatic: r?.dataset.aliveStatic ? Number(r.dataset.aliveStatic) : null,
      showPressed: showButton()?.getAttribute('aria-pressed') === 'true', sub, loopError: r?.dataset.error ?? null };
    rec.samples.push(s);
    if (caption !== lastCaption) { lastCaption = caption; rec.captions.push({ t: s.t, tick: s.tick, caption }); }
  };
  rec.timer = setInterval(sample, 250);
  sample();
  new MutationObserver(list => { for (const m of list) for (const n of m.addedNodes) {
    if (n instanceof HTMLElement && n.classList.contains('toast')) rec.toasts.push({ t: Math.round(performance.now() - rec.t0), tick: window.encore.tick(), err: n.classList.contains('err'), text: n.textContent ?? '' });
  } }).observe(document.body, { childList: true, subtree: true });
  return true;
})()`;

const STATE = `(() => { ${PROBES} const r = readout(); return { tick: window.encore.tick(), showPressed: showButton()?.getAttribute('aria-pressed') === 'true', hasShowButton: Boolean(showButton()), ...captionParts(), loopError: r?.dataset.error ?? null }; })()`;
const COLLECT = `(() => { const rec = window.__demoRecord; rec.done = true; clearInterval(rec.timer); return { deltas: rec.deltas.slice(1), samples: rec.samples, toasts: rec.toasts, captions: rec.captions }; })()`;

// --------------------------------------------------------------------------------------------- server

async function serve() {
  const url = option('url');
  if (url) return { url: url.endsWith('/') ? url : `${url}/`, stop: () => {} };
  if (WINDOWS) console.log('Note: on Windows the preview server this starts may outlive the run; prefer --url (see scripts/demo/README.md).');
  console.log('Building (npm run build)...');
  execFileSync(npm, ['run', 'build'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], ...SHELL });
  const child = spawn(npm, ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', ...SHELL });
  const base = `http://127.0.0.1:${PORT}/`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) return { url: base, stop: () => child.kill() }; } catch { /* not up yet */ }
    await sleep(200);
  }
  child.kill();
  throw new Error(`vite preview did not answer on 127.0.0.1:${PORT} (is the port taken? pass --url)`);
}

// Read-only. A Windows git reading a WSL checkout (\\wsl.localhost\...) refuses it as another user's repo; trust only this one.
const SAFE = ['-c', `safe.directory=${WINDOWS ? `%(prefix)/${ROOT.replaceAll('\\', '/')}` : ROOT}`];
function git() {
  try {
    const sha = execFileSync('git', [...SAFE, 'rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim();
    const dirty = execFileSync('git', [...SAFE, 'status', '--porcelain', '--', 'src', 'index.html'], { cwd: ROOT }).toString().trim() !== '';
    return { sha, dirtySrc: dirty };
  } catch { return null; }
}

function findFfmpeg() {
  const candidates = [process.env.FFMPEG_PATH, 'ffmpeg'].filter(Boolean);
  return candidates.find(bin => spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0) ?? null;
}

// ------------------------------------------------------------------------------------------- stats

const round = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
function intervalStats(ms) {
  if (!ms.length) return null;
  const sorted = [...ms].sort((a, b) => a - b);
  const pick = p => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  const total = ms.reduce((a, b) => a + b, 0);
  return { count: ms.length, meanFps: round((ms.length / total) * 1000, 1), ms: { p50: round(pick(50)), p95: round(pick(95)), p99: round(pick(99)), max: round(sorted.at(-1)) },
    over33ms: ms.filter(d => d > 33.4).length, over50ms: ms.filter(d => d > 50).length, over100ms: ms.filter(d => d > 100).length };
}
/** Frames per whole second of wall time: the worst and best seconds show unevenness a mean hides. */
function perSecond(ms) {
  const buckets = [];
  let t = 0;
  for (const d of ms) { t += d; const i = Math.floor(t / 1000); buckets[i] = (buckets[i] ?? 0) + 1; }
  const full = buckets.slice(0, Math.floor(t / 1000)).map(v => v ?? 0);
  if (!full.length) return null;
  const sorted = [...full].sort((a, b) => a - b);
  return { seconds: full.length, min: sorted[0], p5: sorted[Math.floor(0.05 * sorted.length)], median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1) };
}

// --------------------------------------------------------------------------------------------- main

async function main() {
  const startedAt = new Date().toISOString();
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error('ffmpeg not found on PATH (or $FFMPEG_PATH). It is needed to encode the captured frames.');
  const server = await serve();
  const chrome = await launch({ ...VIEWPORT, gl: GL });
  const frameDir = mkdtempSync(join(tmpdir(), 'encore-demo-frames-'));
  const problems = [];
  const pageErrors = [];
  const frames = [];   // { file, timestamp (s, Chrome's paint time) }
  let report;
  try {
    const page = await openPage(chrome.browser, VIEWPORT);
    page.on('Runtime.exceptionThrown', p => pageErrors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? 'exception'));
    page.on('Runtime.consoleAPICalled', p => { if (p.type === 'error') pageErrors.push(`console.error: ${p.args.map(a => a.value ?? a.description ?? '').join(' ')}`); });
    await page.goto(`${server.url}?seed=${SEED}`);
    await page.eval(WAIT_FOR_APP);
    const gl = await page.eval(GL_INFO);
    const software = !gl.webgl || SOFTWARE.test(`${gl.vendor} ${gl.renderer}`);
    console.log(`WebGL: ${gl.webgl ? `${gl.vendor} / ${gl.renderer}` : 'unavailable'} (${software ? 'SOFTWARE' : 'hardware'})`);
    if (software && !flag('allow-software')) throw new Error('WebGL is a software rasteriser here, so the video would not show the app at its real frame rate. Run on the hardware GL path (on Windows: Windows Node and Chrome with --url), or pass --allow-software.');
    const n0 = await page.eval('window.encore.snapshots().encore.drones.length');
    if (n0 !== 200) throw new Error(`The demo needs n0 = 200; this page has ${n0} drones.`);
    const before = await page.eval(STATE);
    if (!before.hasShowButton) throw new Error('No Show button (aria-pressed) found: this build is not the app shell the recorder expects (#113).');
    await sleep(1000);   // let the first frames settle before the screencast starts

    page.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      page.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      const file = join(frameDir, `f${String(frames.length).padStart(6, '0')}.jpg`);
      writeFileSync(file, Buffer.from(data, 'base64'));
      frames.push({ file, timestamp: metadata.timestamp });
    });
    await page.eval(INSTALL);
    await page.send('Page.startScreencast', { format: 'jpeg', quality: QUALITY, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height, everyNthFrame: 1 });
    await sleep(1000);   // one second of the page before the show starts
    const pressAt = Date.now() / 1000;
    await page.key('d');
    console.log('Pressed D; recording until the app says the demo has finished...');

    // Started: the Show button is pressed. Finished: released again with the end caption on screen.
    let started = false, finishedAt = null, lastLog = 0, last = before;
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      last = await page.eval(STATE);
      if (last.loopError) { problems.push(`Frame loop stopped: ${last.loopError}`); break; }
      if (!started && last.showPressed) started = true;
      if (started && !last.showPressed) { finishedAt = Date.now() / 1000; break; }
      if (Date.now() - lastLog > 10_000) { lastLog = Date.now(); console.log(`  tick ${last.tick}  ${last.sub}`); }
      await sleep(100);
    }
    const endCaption = /^End of the 90-second demo/.test(last.caption);
    if (!started) problems.push('The demo never started (the Show button was not pressed after D).');
    else if (finishedAt === null) problems.push(`The demo did not finish within 240 s of real time (last tick ${last.tick}).`);
    else if (!endCaption) problems.push(`The demo stopped before its end at tick ${last.tick}: "${last.caption}"`);
    if (finishedAt !== null) await sleep(TAIL * 1000);   // keep the end caption on screen for a moment
    await page.send('Page.stopScreencast');
    await sleep(300);
    const rec = await page.eval(COLLECT);
    const final = await page.eval(STATE);

    // Problems the demo itself reported: toasted ("Demo: ...") and repeated in the caption sub-line.
    for (const toast of rec.toasts) if (toast.err) problems.push(`Toast at tick ${toast.tick}: ${toast.text}`);
    const subProblems = [...new Set(rec.samples.map(s => s.sub).filter(sub => /\bproblems?:/.test(sub)))];
    for (const sub of subProblems) problems.push(`Caption sub-line: ${sub}`);
    for (const error of pageErrors) problems.push(`Page error: ${error}`);
    if (started && endCaption && final.tick < END_TICK) problems.push(`End caption shown at tick ${final.tick}, before tick ${END_TICK}.`);

    // Timeline: capture times are Chrome's paint times, so the video plays at the speed the show ran. Chrome can
    // deliver screencast frames a few ms out of paint order; put them back in paint order (the order they were shown).
    const outOfOrder = frames.filter((f, i) => i > 0 && f.timestamp < frames[i - 1].timestamp).length;
    frames.sort((a, b) => a.timestamp - b.timestamp);
    const firstFrame = frames[0]?.timestamp ?? pressAt;
    const intervals = frames.slice(1).map((f, i) => (f.timestamp - frames[i].timestamp) * 1000);
    const showSamples = rec.samples.filter(s => s.showPressed);
    const demoWallSeconds = finishedAt !== null ? finishedAt - pressAt : null;
    report = {
      startedAt, issue: 131,
      settings: { url: server.url, seed: SEED, n0, viewport: VIEWPORT, gl: GL, outputFps: FPS, tailSeconds: TAIL, screencast: `jpeg q${QUALITY}, every frame, acked` },
      machine: { cpu: cpus()[0]?.model ?? 'unknown', logicalCores: cpus().length, memoryGb: Math.round(totalmem() / 2 ** 30), os: `${platform()} ${release()}`, node: process.version,
        browser: chrome.version, browserBinary: chrome.binary, gl, rendering: software ? 'software' : 'hardware' },
      app: git(),
      result: problems.length ? 'PROBLEMS' : 'OK',
      problems,
      demo: { started, finished: finishedAt !== null && endCaption, finalTick: final.tick, endCaption: last.caption,
        wallSecondsFromKeyToEnd: round(demoWallSeconds), videoSecondsAtKeyPress: round(pressAt - firstFrame),
        note: 'Wall time includes the script\'s 0.5x section (ticks 1280-1340), so it is about 3 s longer than 90 s of sim time.' },
      renderFps: { wholeRecording: intervalStats(rec.deltas), perSecond: perSecond(rec.deltas),
        appReadout: (() => { const v = showSamples.map(s => s.appFps).filter(x => x !== null); return v.length ? { min: Math.min(...v), mean: round(v.reduce((a, b) => a + b, 0) / v.length, 1), max: Math.max(...v) } : null; })() },
      captureFps: { frames: frames.length, deliveredOutOfPaintOrder: outOfOrder, ...intervalStats(intervals), perSecond: perSecond(intervals) },
      simulation: (() => {
        if (showSamples.length < 2) return null;
        const a = showSamples[0], b = showSamples.at(-1);
        return { firstTick: a.tick, lastTick: b.tick, ticksPerWallSecond: round(((b.tick - a.tick) / (b.t - a.t)) * 1000), aliveAtEnd: { encore: b.aliveEncore, static: b.aliveStatic } };
      })(),
      captions: rec.captions,
      toasts: rec.toasts,
      samples: rec.samples,
    };
  } finally {
    // On Windows Chrome may still hold its throwaway profile when close() deletes it (EPERM); the recording is unaffected.
    try { await chrome.close(); } catch (error) { console.warn(`Warning: Chrome's temporary profile was not removed (${error.code ?? error}).`); }
    server.stop();
  }

  // Encode: each frame lasts until the next one was painted (the last one for one output frame).
  mkdirSync(OUT, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, '-').slice(0, 19);
  const base = `demo-seed${SEED}-${stamp}`;
  const video = join(OUT, `${base}.mp4`);
  if (frames.length < 2) throw new Error(`Only ${frames.length} frames were captured; nothing to encode.`);
  const list = frames.map((f, i) => `file '${f.file.replaceAll('\\', '/')}'\nduration ${(i + 1 < frames.length ? frames[i + 1].timestamp - f.timestamp : 1 / FPS).toFixed(6)}`);
  list.push(`file '${frames.at(-1).file.replaceAll('\\', '/')}'`);
  const listFile = join(frameDir, 'frames.txt');
  writeFileSync(listFile, `${list.join('\n')}\n`);
  console.log(`Encoding ${frames.length} frames to ${video} at ${FPS} fps constant (frames repeated or dropped at their real times, never blended)...`);
  const encode = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-fps_mode', 'cfr', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (encode.status !== 0) throw new Error(`ffmpeg failed (exit ${encode.status}); frames kept in ${frameDir}`);
  const probe = spawnSync(ffmpeg.replace(/ffmpeg(\.exe)?$/i, m => m.replace('ffmpeg', 'ffprobe')), ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'json', video]);
  try { report.video = { file: video, ...JSON.parse(probe.stdout.toString()).format }; } catch { report.video = { file: video }; }
  report.video.durationSeconds = round(Number(report.video.duration));
  const sidecar = join(OUT, `${base}.json`);
  writeFileSync(sidecar, `${JSON.stringify(report, null, 2)}\n`);
  if (flag('keep-frames')) console.log(`Frames kept in ${frameDir}`); else rmSync(frameDir, { recursive: true, force: true });

  const r = report;
  console.log(`\nVideo:   ${video} (${r.video.durationSeconds} s, ${round(Number(r.video.size) / 2 ** 20, 1)} MB)`);
  console.log(`Sidecar: ${sidecar}`);
  console.log(`Render:  ${r.renderFps.wholeRecording?.meanFps} fps mean, frame ms p95 ${r.renderFps.wholeRecording?.ms.p95}, worst second ${r.renderFps.perSecond?.min} frames, ${r.renderFps.wholeRecording?.over50ms} frames > 50 ms`);
  console.log(`Capture: ${r.captureFps.meanFps} fps mean, interval p95 ${r.captureFps.ms?.p95} ms, max ${r.captureFps.ms?.max} ms, worst second ${r.captureFps.perSecond?.min} frames, ${r.captureFps.over100ms} gaps > 100 ms`);
  console.log(`Demo:    ${r.demo.finished ? 'finished' : 'DID NOT FINISH'} at tick ${r.demo.finalTick}, ${r.demo.wallSecondsFromKeyToEnd} s from D to the end`);
  if (r.problems.length) {
    console.error(`\nFAILED: ${r.problems.length} problem(s). Do not use this recording as the canonical demo.`);
    for (const p of r.problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else console.log('\nOK: no beat reported a problem.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
