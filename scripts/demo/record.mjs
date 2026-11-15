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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, openPage, sleep } from '../perf/cdp.mjs';

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
// page.eval has no timeout of its own: a hung renderer would never answer. Every call to the page races a Node timer.
const EVAL_MS = 5_000;
const APP_MS = 35_000;   // WAIT_FOR_APP gives up in the page after 30 s

function within(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} did not answer within ${ms / 1000} s (renderer hung?)`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
const ask = (page, expression, what, ms = EVAL_MS) => within(page.eval(expression), ms, what);

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
  if (WINDOWS && ROOT.startsWith('\\\\')) throw new Error('This checkout is on a network path (e.g. \\\\wsl.localhost), where npm cannot build. Build and serve it in WSL and pass --url (see scripts/demo/README.md).');
  console.log('Building (npm run build)...');
  execFileSync(npm, ['run', 'build'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], ...SHELL });
  // A server already on the port would answer for us while our vite exits under --strictPort, and its build would be
  // recorded under this checkout's name. So the port must be free, and only vite's own "Local:" line means ready.
  if (!(await portFree(PORT))) throw new Error(`Port ${PORT} on 127.0.0.1 is already in use, so this run could record another server's build. Stop that server, or serve this checkout yourself and pass --url.`);
  // vite itself, not `npm run preview`: npm does not pass a kill on to the vite it started, so the server outlived the run.
  const child = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolveReady, rejectReady) => {
      let out = '';
      const done = error => {
        clearTimeout(timer); child.stdout.off('data', onData); child.stderr.off('data', onData); child.off('exit', onExit);
        if (error) rejectReady(error); else resolveReady();
      };
      const onData = chunk => {
        out += chunk;
        const local = out.replace(/\u001b\[[0-9;]*m/g, '').match(/Local:\s+http:\/\/127\.0\.0\.1:(\d+)\//);
        if (local) done(local[1] === String(PORT) ? null : new Error(`vite preview started on port ${local[1]}, not ${PORT}`));
      };
      const onExit = code => done(new Error(`vite preview exited (code ${code}) before it was ready: ${out.slice(-400)}`));
      const timer = setTimeout(() => done(new Error(`vite preview printed no "Local:" line within 20 s: ${out.slice(-400)}`)), 20_000);
      child.stdout.on('data', onData); child.stderr.on('data', onData); child.once('exit', onExit);
    });
  } catch (error) { child.kill(); throw error; }
  child.stdout.resume(); child.stderr.resume();   // keep draining, so vite never blocks on a full pipe
  return { url: `http://127.0.0.1:${PORT}/`, stop: () => child.kill() };
}

function portFree(port) {
  return new Promise(resolveFree => {
    const probe = createServer();
    probe.once('error', () => resolveFree(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolveFree(true)));
  });
}

/** The served page must be this checkout's build: its index.html (with the hashed asset names) equals dist/index.html. */
async function checkServedBuild(url) {
  let local;
  try { local = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8'); } catch { throw new Error('This checkout has no dist/index.html, so the served build cannot be checked against it. Run npm run build here first.'); }
  const served = await (await within(fetch(url), EVAL_MS, `Fetching ${url}`)).text();
  if (served !== local) throw new Error(`The page at ${url} is not this checkout's build (its index.html differs from dist/index.html). Serve this checkout's build, or rebuild it.`);
  return { servedMatchesDist: true };
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
  let chrome;
  let frameDir = null;
  let recording = false;   // set once the screencast is asked to start: from then on, failures are problems, not throws
  const problems = [];
  const pageErrors = [];
  const frames = [];   // { file, timestamp (s, Chrome's paint time) }
  let report;
  try {
    // Before the recording starts there is nothing to save, so a failure here throws (exit 1, no video or sidecar).
    const served = await checkServedBuild(server.url);
    frameDir = mkdtempSync(join(tmpdir(), 'encore-demo-frames-'));
    chrome = await launch({ ...VIEWPORT, gl: GL });
    const page = await openPage(chrome.browser, VIEWPORT);
    page.on('Runtime.exceptionThrown', p => pageErrors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? 'exception'));
    page.on('Runtime.consoleAPICalled', p => { if (p.type === 'error') pageErrors.push(`console.error: ${p.args.map(a => a.value ?? a.description ?? '').join(' ')}`); });
    await page.goto(`${server.url}?seed=${SEED}`);
    await ask(page, WAIT_FOR_APP, 'The app (window.encore)', APP_MS);
    const gl = await ask(page, GL_INFO, 'The WebGL probe');
    const software = !gl.webgl || SOFTWARE.test(`${gl.vendor} ${gl.renderer}`);
    console.log(`WebGL: ${gl.webgl ? `${gl.vendor} / ${gl.renderer}` : 'unavailable'} (${software ? 'SOFTWARE' : 'hardware'})`);
    if (software && !flag('allow-software')) throw new Error('WebGL is a software rasteriser here, so the video would not show the app at its real frame rate. Run on the hardware GL path (on Windows: Windows Node and Chrome with --url), or pass --allow-software.');
    const n0 = await ask(page, 'window.encore.snapshots().encore.drones.length', 'The roster probe');
    if (n0 !== 200) throw new Error(`The demo needs n0 = 200; this page has ${n0} drones.`);
    const before = await ask(page, STATE, 'The page');
    if (!before.hasShowButton) throw new Error('No Show button (aria-pressed) found: this build is not the app shell the recorder expects (#113).');
    await ask(page, INSTALL, 'Installing the page recorder');
    await sleep(1000);   // let the first frames settle before the screencast starts

    let capturing = true;
    page.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      page.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      if (!capturing) return;
      const file = join(frameDir, `f${String(frames.length).padStart(6, '0')}.jpg`);
      writeFileSync(file, Buffer.from(data, 'base64'));
      frames.push({ file, timestamp: metadata.timestamp });
    });

    // From here on every failure is a problem in the sidecar, and whatever was captured is still encoded.
    // One stop reason: 'finished' (Show released), 'not-started', 'loop-error', 'hung', 'error', or 'deadline'.
    recording = true;
    let started = false, finishedAt = null, last = before, stop = null, pressAt = null;
    try {
      await within(page.send('Page.startScreencast', { format: 'jpeg', quality: QUALITY, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height, everyNthFrame: 1 }), EVAL_MS, 'Page.startScreencast');
      await sleep(1000);   // one second of the page before the show starts
      pressAt = Date.now() / 1000;
      await within(page.key('d'), EVAL_MS, 'The D key press');
      console.log('Pressed D; recording until the app says the demo has finished...');
      let lastLog = 0;
      const deadline = Date.now() + 240_000;
      while (stop === null && Date.now() < deadline) {
        try { last = await ask(page, STATE, 'The page'); } catch (error) { problems.push(`Polling the page failed at tick ${last.tick}: ${error.message}`); stop = 'hung'; break; }
        if (last.loopError) { problems.push(`Frame loop stopped: ${last.loopError}`); stop = 'loop-error'; break; }
        if (!started && last.showPressed) started = true;
        if (started && !last.showPressed) { finishedAt = Date.now() / 1000; stop = 'finished'; break; }
        if (!started && Date.now() / 1000 - pressAt > 10) { problems.push('The demo did not start within 10 s of D (the Show button was never pressed).'); stop = 'not-started'; break; }
        if (Date.now() - lastLog > 10_000) { lastLog = Date.now(); console.log(`  tick ${last.tick}  ${last.sub}`); }
        await sleep(100);
      }
      if (stop === null) { stop = 'deadline'; problems.push(`The demo did not finish within 240 s of real time (last tick ${last.tick}).`); }
    } catch (error) { problems.push(`Recording failed: ${error.message}`); stop = 'error'; }
    const endCaption = /^End of the 90-second demo/.test(last.caption);
    if (stop === 'finished' && !endCaption) problems.push(`The demo stopped before its end at tick ${last.tick}: "${last.caption}"`);
    if (stop === 'finished') await sleep(TAIL * 1000);   // keep the end caption on screen for a moment
    try { await within(page.send('Page.stopScreencast'), EVAL_MS, 'Page.stopScreencast'); } catch (error) { problems.push(error.message); }
    capturing = false;
    await sleep(300);
    let rec = { deltas: [], samples: [], toasts: [], captions: [] };
    let final = last;
    try { rec = await ask(page, COLLECT, 'Collecting the page record'); } catch (error) { problems.push(`${error.message}; the sidecar has no render fps, samples, captions or toasts`); }
    try { final = await ask(page, STATE, 'The page'); } catch (error) { problems.push(`${error.message}; demo.finalTick is the last polled tick, not the tick at the end of the recording`); }

    // Problems the demo itself reported: toasted ("Demo: ...") and repeated in the caption sub-line.
    for (const toast of rec.toasts) if (toast.err) problems.push(`Toast at tick ${toast.tick}: ${toast.text}`);
    const subProblems = [...new Set(rec.samples.map(s => s.sub).filter(sub => /\bproblems?:/.test(sub)))];
    for (const sub of subProblems) problems.push(`Caption sub-line: ${sub}`);
    for (const error of pageErrors) problems.push(`Page error: ${error}`);
    if (stop === 'finished' && endCaption && final.tick < END_TICK) problems.push(`End caption shown at tick ${final.tick}, before tick ${END_TICK}.`);

    // Timeline: capture times are Chrome's paint times, so the video plays at the speed the show ran. Chrome can
    // deliver screencast frames a few ms out of paint order; put them back in paint order (the order they were shown).
    const outOfOrder = frames.filter((f, i) => i > 0 && f.timestamp < frames[i - 1].timestamp).length;
    frames.sort((a, b) => a.timestamp - b.timestamp);
    const firstFrame = frames[0]?.timestamp ?? pressAt;
    const intervals = frames.slice(1).map((f, i) => (f.timestamp - frames[i].timestamp) * 1000);
    const showSamples = rec.samples.filter(s => s.showPressed);
    report = {
      startedAt, issue: 131,
      settings: { url: server.url, seed: SEED, n0, viewport: VIEWPORT, gl: GL, outputFps: FPS, tailSeconds: TAIL, screencast: `jpeg q${QUALITY}, every frame, acked` },
      machine: { cpu: cpus()[0]?.model ?? 'unknown', logicalCores: cpus().length, memoryGb: Math.round(totalmem() / 2 ** 30), os: `${platform()} ${release()}`, node: process.version,
        browser: chrome.version, browserBinary: chrome.binary, gl, rendering: software ? 'software' : 'hardware' },
      app: { ...git(), ...served },
      result: 'OK',
      problems,
      demo: { started, stop, finished: stop === 'finished' && endCaption, finalTick: final.tick, endCaption: last.caption,
        wallSecondsFromKeyToEnd: round(finishedAt !== null && pressAt !== null ? finishedAt - pressAt : null),
        videoSecondsAtKeyPress: round(pressAt !== null && firstFrame !== null ? pressAt - firstFrame : null),
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
      video: null,
    };
  } finally {
    // cdp.mjs handles both Windows races since #155; a failed cleanup must still never lose the recording.
    try { await chrome?.close(); } catch (error) { console.warn(`Warning: closing Chrome failed (${error.code ?? error}).`); }
    server.stop();
    if (!recording && frameDir) rmSync(frameDir, { recursive: true, force: true });   // failed before recording: nothing to keep
  }

  // The sidecar and the problems come first, so an encoding failure cannot lose them; `video` is added afterwards.
  mkdirSync(OUT, { recursive: true });
  const base = `demo-seed${SEED}-${startedAt.replace(/[:.]/g, '-').slice(0, 19)}`;
  const sidecar = join(OUT, `${base}.json`);
  const writeSidecar = () => { report.result = report.problems.length ? 'PROBLEMS' : 'OK'; writeFileSync(sidecar, `${JSON.stringify(report, null, 2)}\n`); };
  writeSidecar();
  const r = report;
  console.log(`\nSidecar: ${sidecar}`);
  console.log(`Render:  ${r.renderFps.wholeRecording?.meanFps} fps mean, frame ms p95 ${r.renderFps.wholeRecording?.ms.p95}, worst second ${r.renderFps.perSecond?.min} frames, ${r.renderFps.wholeRecording?.over50ms} frames > 50 ms`);
  console.log(`Capture: ${r.captureFps.meanFps} fps mean, interval p95 ${r.captureFps.ms?.p95} ms, max ${r.captureFps.ms?.max} ms, worst second ${r.captureFps.perSecond?.min} frames, ${r.captureFps.over100ms} gaps > 100 ms`);
  console.log(`Demo:    ${r.demo.finished ? 'finished' : `DID NOT FINISH (${r.demo.stop})`} at tick ${r.demo.finalTick}, ${r.demo.wallSecondsFromKeyToEnd} s from D to the end`);
  const reportProblems = () => {
    if (!r.problems.length) { console.log('\nOK: no beat reported a problem.'); return; }
    console.error(`\nFAILED: ${r.problems.length} problem(s). Do not use this recording as the canonical demo.`);
    for (const p of r.problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  };
  reportProblems();

  // Encode: each frame lasts until the next one was painted (the last one for one output frame).
  if (frames.length < 2) {
    r.problems.push(`Only ${frames.length} frame(s) were captured; no video was encoded.`);
    rmSync(frameDir, { recursive: true, force: true });
    writeSidecar();
    reportProblems();
    return;
  }
  const video = join(OUT, `${base}.mp4`);
  const list = frames.map((f, i) => `file '${f.file.replaceAll('\\', '/')}'\nduration ${(i + 1 < frames.length ? frames[i + 1].timestamp - f.timestamp : 1 / FPS).toFixed(6)}`);
  list.push(`file '${frames.at(-1).file.replaceAll('\\', '/')}'`);
  const listFile = join(frameDir, 'frames.txt');
  writeFileSync(listFile, `${list.join('\n')}\n`);
  console.log(`\nEncoding ${frames.length} frames to ${video} at ${FPS} fps constant (frames repeated or dropped at their real times, never blended)...`);
  const encode = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-fps_mode', 'cfr', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (encode.status !== 0) {
    r.problems.push(`ffmpeg failed (exit ${encode.status ?? encode.error?.message}); frames kept in ${frameDir}`);
    r.video = { file: null, error: `ffmpeg exit ${encode.status}` };
    writeSidecar();
    reportProblems();
    return;
  }
  const probe = spawnSync(ffmpeg.replace(/ffmpeg(\.exe)?$/i, m => m.replace('ffmpeg', 'ffprobe')), ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'json', video]);
  try { r.video = { file: video, ...JSON.parse(probe.stdout.toString()).format }; } catch { r.video = { file: video }; }
  r.video.durationSeconds = round(Number(r.video.duration));
  writeSidecar();
  if (flag('keep-frames')) console.log(`Frames kept in ${frameDir}`); else rmSync(frameDir, { recursive: true, force: true });
  console.log(`Video:   ${video} (${r.video.durationSeconds} s, ${round(Number(r.video.size) / 2 ** 20, 1)} MB)`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
