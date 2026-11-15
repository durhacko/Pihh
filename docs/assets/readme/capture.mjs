#!/usr/bin/env node
// docs/assets/readme/capture.mjs
// Captures the README's app images from the real app in headless Chrome: the repair animation (repair.gif) and
// three cropped stills (stage-split.png, score-beliefs.png, stage-after-repair.png).
//
//   npm run build && npx vite preview --host 127.0.0.1 --port 4291 --strictPort &
//   node docs/assets/readme/capture.mjs --url http://127.0.0.1:4291/
//
// Needs Chrome (found by scripts/perf/cdp.mjs) and ImageMagick `convert` for the GIF.
// Nothing here changes the simulation: it loads the app, uses the public window.encore API and keys that a user
// has (H hides the comparison panel), pauses the clock on exact ticks and takes screenshots.
//
// The repair animation is two runs of the same seed with the same scheduled kill: the default (Encore) view and
// ?arm=static. Both worlds always run in lockstep in the app and get the same event, so each run also carries the
// other world; the view only chooses which one is drawn. The kill is the scripted demo's regional kill: every live
// drone within 6 m of (-35, 30.4, 0), the first E of ENCORE, scheduled at about tick 400 (the label uses the tick
// of the event the app actually scheduled). Frames are paused near their target tick and labelled with the tick
// they were actually taken at, so spacing is about, not exactly, 0.6 s.
//
// The stills are cropped to the stage and the panel their caption refers to (crop only, no retouching):
//   stage-split.png         ?split=1, paused at tick 380 in the ENCORE hold, before any event.
//   score-beliefs.png       click drone 100, J (jam of 12 m around it, app shell #113), click drone 20, C (belief
//                           colours), I (opens the Composer) and its Inject button; paused 80 ticks after the
//                           injection, with drone 20's inspector open.
//   stage-after-repair.png  the Encore view of the repair run, paused at tick 893, Metrics (M) open.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, openPage, sleep } from '../../../scripts/perf/cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const option = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const URL = option('url');
if (!URL) throw new Error('pass --url of a running build (vite preview)');
const VIEW = { width: 1440, height: 900 };
const KILL = { centre: [-35, 30.4, 0], radius: 6, tick: 400 };
const FRAME_TICKS = [];
for (let t = 388; t <= 892; t += 12) FRAME_TICKS.push(t);
const CLIP = { x: 300, y: 340, width: 840, height: 215, scale: 1 };
const STAGE_CLIP = { x: 300, y: 0, width: 1130, height: 770, scale: 1 };     // formation and the Metrics panel
const SPLIT_CLIP = { x: 400, y: 0, width: 1040, height: 760, scale: 1 };     // both worlds and the readout
const BELIEF_CLIP = { x: 0, y: 100, width: 1440, height: 730, scale: 1 };    // formation, inspector and beliefs legend

const WAIT_FOR_APP = `new Promise((resolve, reject) => {
  const start = performance.now();
  (function poll() {
    if (window.encore && window.encore.tick() > 0) return resolve(true);
    if (performance.now() - start > 30000) return reject(new Error('window.encore did not appear'));
    setTimeout(poll, 100);
  })();
})`;
const waitTick = t => `new Promise(r => (function w() { window.encore.tick() >= ${t} ? r(window.encore.tick()) : setTimeout(w, 20); })())`;

async function shot(page, clip) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, ...(clip ? { clip } : {}) });
  return Buffer.from(data, 'base64');
}

/** Pause exactly on tick t: run slowly near it and pause from inside the page's own animation frame, so no
 *  round trip to the page can let the clock overshoot. At 0.25x the app advances at most one tick per frame. */
async function pauseAt(page, t) {
  await page.eval(`window.encore.setSpeed(2)`);
  await page.eval(waitTick(t - 10));
  await page.eval(`window.encore.setSpeed(0.25)`);
  const at = await page.eval(`new Promise(r => (function w() {
    if (window.encore.tick() >= ${t}) { window.encore.setPlaying(false); r(window.encore.tick()); } else requestAnimationFrame(w);
  })())`);
  await sleep(350);   // let the renderer draw the paused frame
  return at;
}

async function selectDrone(page, id) {
  const at = await page.eval(`window.encore.screenOf(${id})`);
  if (!at) throw new Error(`drone ${id} is not on screen`);
  await page.click(at[0], at[1]);
  await sleep(300);
}

async function stills(chrome) {
  const split = await openPage(chrome.browser, VIEW);
  await split.goto(`${URL}?seed=101&split=1`);
  await split.eval(WAIT_FOR_APP);
  const splitTick = await pauseAt(split, 380);
  writeFileSync(join(HERE, 'stage-split.png'), await shot(split, SPLIT_CLIP));
  await split.close();

  const page = await openPage(chrome.browser, VIEW);
  await page.goto(`${URL}?seed=101`);
  await page.eval(WAIT_FOR_APP);
  await pauseAt(page, 330);
  await selectDrone(page, 100);
  await page.key('j');
  await page.eval('window.encore.setPlaying(true)');
  const injectAt = (await pauseAt(page, 345)) + 1;
  await selectDrone(page, 20);
  await page.key('c');
  await page.key('i');                       // opens the Composer (app shell, #113); nothing is sent yet
  await sleep(600);
  const injected = await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find(b => /^Inject/.test(b.textContent.trim()) && b.offsetParent !== null); if (b) b.click(); return Boolean(b); })()`);
  if (!injected) throw new Error('Composer Inject button not found');
  await sleep(400);
  await page.key('Escape');
  await page.eval('window.encore.setPlaying(true)');
  const beliefTick = await pauseAt(page, injectAt + 80);
  const versions = (await page.eval('window.encore.samples()')).encore.versions;
  writeFileSync(join(HERE, 'score-beliefs.png'), await shot(page, BELIEF_CLIP));
  await page.close();
  return { splitTick, beliefTick, injectAt, versions };
}

async function run(chrome, query, frameDir, label) {
  const page = await openPage(chrome.browser, VIEW);
  await page.goto(`${URL}?seed=101${query}`);
  await page.eval(WAIT_FOR_APP);
  const frames = [];
  let killed = false;
  let killTick = null;
  for (const t of FRAME_TICKS) {
    if (!killed && t >= KILL.tick - 1) {
      await pauseAt(page, KILL.tick - 1);
      const event = await page.eval(`window.encore.killRegion(${JSON.stringify(KILL.centre)}, ${KILL.radius})`);   // lands at tick + 1
      killTick = event.tick;
      killed = true;
      await page.eval('window.encore.setPlaying(true)');
    }
    const at = await pauseAt(page, t);
    if (frames.length === 0) { await page.key('h'); await sleep(300); }   // hide the comparison panel for the crops
    const alive = await page.eval('window.encore.alive()');
    const file = join(frameDir, `${label}-${String(frames.length).padStart(3, '0')}.png`);
    writeFileSync(file, await shot(page, CLIP));
    frames.push({ tick: at, file, alive });
    await page.eval('window.encore.setPlaying(true)');
  }
  // Full-frame still at the last tick, with the comparison panel shown again.
  await pauseAt(page, FRAME_TICKS.at(-1) + 1);
  await page.key('h');                       // controls back
  await page.key('m');                       // Metrics: both worlds compared on the same tick
  await sleep(500);
  const still = await shot(page, STAGE_CLIP);
  const samples = await page.eval('window.encore.samples()');
  await page.close();
  return { frames, still, samples, killTick };
}

const chrome = await launch(VIEW);
const frameDir = mkdtempSync(join(tmpdir(), 'encore-readme-frames-'));
try {
  const encore = await run(chrome, '', frameDir, 'encore');
  const stat = await run(chrome, '&arm=static', frameDir, 'static');
  for (const [a, b] of encore.frames.map((f, i) => [f, stat.frames[i]])) {
    if (Math.abs(a.tick - b.tick) > 1) throw new Error(`frame ticks differ: ${a.tick} vs ${b.tick}`);
  }
  mkdirSync(HERE, { recursive: true });
  writeFileSync(join(HERE, 'stage-after-repair.png'), encore.still);
  const still = await stills(chrome);
  console.log(`stills: split at tick ${still.splitTick}; beliefs at tick ${still.beliefTick} (inject ~${still.injectAt}): ${JSON.stringify(still.versions)}`);
  const first = encore.frames[0].alive.encore;
  const killed = first - encore.frames.at(-1).alive.encore;
  if (killed !== first - stat.frames.at(-1).alive.static) throw new Error('the two runs lost different numbers of drones');
  if (encore.killTick !== stat.killTick) throw new Error(`the kill landed on different ticks: ${encore.killTick} vs ${stat.killTick}`);
  const manifest = { url: URL, kill: KILL, frames: encore.frames.map((f, i) => ({ tick: f.tick, encoreAlive: f.alive, staticView: stat.frames[i].tick })), samples: { encoreRun: encore.samples, staticRun: stat.samples } };
  writeFileSync(join(frameDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Stack Encore over static per frame, label them, and assemble the GIF.
  const stacked = [];
  const font = ['-font', 'DejaVu-Sans-Mono', '-pointsize', '15', '-fill', '#a9bec8'];
  for (let i = 0; i < encore.frames.length; i++) {
    const tick = encore.frames[i].tick;
    const out = join(frameDir, `stack-${String(i).padStart(3, '0')}.png`);
    const seconds = (tick * 0.05).toFixed(1);
    const killNote = tick >= encore.killTick ? ` · ${killed} drones killed at ${(encore.killTick * 0.05).toFixed(2)} s` : '';
    execFileSync('convert', [
      '(', encore.frames[i].file, '-gravity', 'northwest', ...font, '-annotate', '+14+10', 'ENCORE BRAIN', ')',
      '(', stat.frames[i].file, '-gravity', 'northwest', ...font, '-annotate', '+14+10', 'STATIC BASELINE', ')',
      '-append', '+repage', '-gravity', 'southwest', ...font, '-fill', '#7f99a6', '-annotate', '+14+10', `seed 101 · t = ${seconds} s${killNote}`,
      out,
    ]);
    stacked.push(out);
  }
  const gif = join(HERE, 'repair.gif');
  execFileSync('convert', ['-delay', '18', '-loop', '0', ...stacked, '-delay', '160', stacked.at(-1), '+repage', '-colors', '96', '-layers', 'Optimize', gif]);
  console.log(`frames: ${frameDir}\nwrote ${gif}, stage-after-repair.png, stage-split.png and score-beliefs.png`);
} finally {
  await chrome.close();
}
