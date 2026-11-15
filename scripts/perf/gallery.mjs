#!/usr/bin/env node
// scripts/perf/gallery.mjs
// Issue #141: the Devpost gallery. Seven unedited stills of the real app at seed 101, 1440x900, hardware WebGL, plus
// captions.json with each still's provenance and the observer state it shows.
//
//   node scripts/perf/gallery.mjs --url http://127.0.0.1:4173/ --out docs/demo/media [--commit <sha>]
//
// Needs a running production build (npm run build && npm run preview) and a Chrome that reaches a GPU: on Windows run
// it with Windows Node (WSL's headless Chrome renders in software). It refuses to capture on a software renderer.
// Beat 01 is an independent seed 101 run in single Encore view. Beats 02-07 come from ONE scripted demo run (D):
// the transport is paused on the exact tick, the demo's own speed is put back before the screenshot (so the dock
// shows the show's speed, not the capture tool's slow-down), and the tick is checked unchanged after it.
// PNG bytes are written exactly as Chrome returns them: no crop, no edit. Captions quote the observer's numbers.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, openPage, sleep } from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const option = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const URL_ = option('url', 'http://127.0.0.1:4173/');
const OUT = resolve(option('out', join(ROOT, 'docs', 'demo', 'media')));
const COMMIT = option('commit') ?? (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim(); } catch { return 'unknown'; } })();
const VIEWPORT = { width: 1440, height: 900 };
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;
const fmt = v => v.toFixed(3);
const versionsText = v => Object.entries(v).map(([k, n]) => `${n} on ${k === '0:-1' ? 'the preloaded score' : `version ${k}`}`).join(', ');

const BEATS = [
  { n: '01', name: 'formation-hold', tick: 390, demo: false, run: 'independent seed 101 run, default score, no disruption',
    caption: r => `The opening ENCORE formation in its hold, before any disruption: ${r.alive.encore} live drones, each flying its preloaded score on the shared clock. Single Encore view; an independent seed 101 run, not a frame of the scripted demo. Observer nPWC ${fmt(r.samples.encore.npwc)}.` },
  { n: '02', name: 'kill-split', tick: 405, demo: true, run: 'scripted demo, seed 101, one continuous run',
    caption: r => `Scripted demo, ${r.tick - 400} ticks after the regional kill at tick 400: the same ${200 - r.alive.encore} drones failed in both worlds, leaving ${r.alive.encore} live in each. Split view, Encore above and the static baseline below. X-ray draws a sample of the Encore world's real radio log; the static world sends no radio.` },
  { n: '03', name: 'repair-split', tick: 850, demo: true, run: 'scripted demo, seed 101, one continuous run',
    caption: r => `Same run, ${((r.tick - 400) / 20).toFixed(1)} s after the kill: in the Encore world, survivors next to the hole have moved into the vacated, more important slots, so the first E thins instead of keeping a hole; the static world keeps its hole. Observer nPWC ${fmt(r.samples.encore.npwc)} vs ${fmt(r.samples.static.npwc)}, with plain coverage equal at ${fmt(r.samples.encore.coverage)} (${r.alive.encore} live drones in each). Repair is local and partial.` },
  { n: '04', name: 'jam-xray', tick: 1260, demo: true, run: 'scripted demo, seed 101, one continuous run',
    caption: r => `A simulated radio jam (orange sphere) over the top of the sphere formation, ${((r.tick - 1220) / 20).toFixed(0)} s after it started, as the swarm settles into the sphere. The jam is applied to both worlds, so it is drawn in both panes; the static world sends no radio, so it changes nothing there. Belief colours show the score version each drone holds (${versionsText(r.samples.encore.versions)}); X-ray draws a sample of the real radio messages of the selected drone 151. The inspector shows that drone's own knowledge above a separate observer box.` },
  { n: '05', name: 'injection-spread', tick: 1320, demo: true, run: 'scripted demo, seed 101, one continuous run',
    caption: r => `${((r.tick - 1280) / 20).toFixed(0)} s after a helix score was injected into drone 151 (tick 1280), with the jam still on: Encore drones hold ${versionsText(r.samples.encore.versions)}; the drones still on the old score are the deaf ones inside the jam (green: new score, amber: preloaded). The static baseline stays on its preloaded score: it cannot adopt one, a capability difference, not a performance result.` },
  { n: '06', name: 'final-split', tick: 1790, demo: true, deselect: true, run: 'scripted demo, seed 101, one continuous run',
    caption: r => `Final beat of the scripted demo (tick ${r.tick}), audience view: the Encore world flies the injected helix score (${versionsText(r.samples.encore.versions)}) while the static world holds its preloaded sphere. Because the two worlds hold different formations, the readout marks their nPWC values (${fmt(r.samples.encore.npwc)} and ${fmt(r.samples.static.npwc)}) as not comparable.` },
  { n: '07', name: 'final-metrics', tick: 1830, demo: true, deselect: true, metrics: true, run: 'scripted demo, seed 101, one continuous run (after its end beat at tick 1800)',
    caption: r => `The Metrics popover just after the demo ends (tick ${r.tick}), both worlds measured by the observer on the same tick, costs included: ${r.samples.encore.collisions} vs ${r.samples.static.collisions} collisions, ${r.samples.encore.nearMisses} vs ${r.samples.static.nearMisses} near-misses and ${r.samples.encore.slotChanges} vs ${r.samples.static.slotChanges} slot changes (Encore vs static). Plain coverage is equal (${fmt(r.samples.encore.coverage)}): the same drones died in both worlds. Static ignores the injected score by design, a capability difference, not a performance result. A demo readout, not the evaluation matrix.` },
];

const WAIT_FOR_APP = `new Promise((res, rej) => { const t0 = performance.now(); (function p() {
  if (window.encore && typeof window.encore.tick === 'function' && window.encore.tick() > 0) return res(true);
  const e = document.querySelector('.error')?.textContent; if (e) return rej(new Error(e));
  if (performance.now() - t0 > 20000) return rej(new Error('window.encore did not appear in 20 s'));
  setTimeout(p, 100); })(); })`;
const GL_INFO = `(() => { const g = document.createElement('canvas').getContext('webgl2'); if (!g) return { webgl: false };
  const d = g.getExtension('WEBGL_debug_renderer_info');
  return { webgl: true, vendor: g.getParameter(d.UNMASKED_VENDOR_WEBGL), renderer: g.getParameter(d.UNMASKED_RENDERER_WEBGL), version: g.getParameter(g.VERSION) }; })()`;
const SPEED_SHOWN = `(() => { const b = document.querySelector('[aria-label^="Playback speed"]'); const v = parseFloat((b?.innerText ?? '').replace('×', '')); return Number.isFinite(v) ? v : 1; })()`;
/** Pauses on exactly `target`: 0.25x from 4 ticks before, stop on the frame the tick reaches it, then the show's own speed back. */
const PAUSE_AT = target => `new Promise(res => { const e = window.encore; let speed0 = null;
  (function f() { const t = e.tick();
    if (speed0 === null && t >= ${target} - 4) { speed0 = ${SPEED_SHOWN}; e.setSpeed(0.25); }
    if (t >= ${target}) { e.setPlaying(false); e.setSpeed(speed0 ?? ${SPEED_SHOWN}); return res(speed0 ?? 1); }
    requestAnimationFrame(f); })(); })`;
const STATE = `(() => { const e = window.encore, st = e.store.state, sm = e.samples();
  const pick = s => ({ npwc: s.npwc, coverage: s.coverage, sfMean: s.sfMean, sfMax: s.sfMax, versions: s.versions, collisions: s.collisions, nearMisses: s.nearMisses, slotChanges: s.slotChanges, msgs: s.msgs });
  const snap = e.snapshots();
  return { tick: e.tick(), alive: e.alive(), view: st.view, lenses: st.lenses, selected: st.selected ?? null,
    jams: { encore: snap.encore.jams, static: snap.static.jams }, partitions: { encore: snap.encore.partitions, static: snap.static.partitions },
    speedShown: document.querySelector('[aria-label^="Playback speed"]')?.innerText ?? null,
    panels: [...document.querySelectorAll('[aria-label]')].filter(x => x.getClientRects().length && /^(Metrics|Drone inspector|Legend|Console|Show timeline|Formation composer)$/.test(x.getAttribute('aria-label'))).map(x => x.getAttribute('aria-label')),
    samples: { encore: pick(sm.encore), static: pick(sm.static) } }; })()`;

/** Pairs of visible overlays (caption bar, dock, readout, Metrics, inspector, legend) whose boxes intersect. */
const OVERLAPS = `(() => { const sel = ['.caption.surface', 'nav[aria-label="Encore controls"]', '[aria-label="Open metrics (M)"]', '[aria-label="Metrics"]', '[aria-label="Drone inspector"]', '[aria-label="Legend"]'];
  const boxes = sel.map(s => [s, document.querySelector(s)]).filter(([, el]) => el && !el.hidden && el.getClientRects().length).map(([s, el]) => [s, el.getBoundingClientRect()]);
  const out = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const [a, ra] = boxes[i], [b, rb] = boxes[j];
    if (ra.left < rb.right && rb.left < ra.right && ra.top < rb.bottom && rb.top < ra.bottom) out.push([a, b]); }
  return out; })()`;
const DESELECT = `new Promise(res => { let n = 0; (function f() { const e = window.encore;
  if (e.store.state.selected === null || n++ > 5) return res(e.store.state.selected);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); setTimeout(f, 150); })(); })`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const chrome = await launch({ ...VIEWPORT, gl: 'auto' });
  try {
    const page = await openPage(chrome.browser, VIEWPORT);
    await page.goto(`${URL_}?seed=101`);
    await page.eval(WAIT_FOR_APP);
    const gl = await page.eval(GL_INFO);
    if (!gl.webgl || SOFTWARE.test(`${gl.vendor} ${gl.renderer}`)) throw new Error(`Not a hardware renderer: ${gl.renderer ?? 'no WebGL'}`);
    console.log(`GL: ${gl.renderer}`);

    const captures = [];
    const shoot = async beat => {
      // No overlapping UI in a gallery still: every pair of visible overlays must be disjoint.
      const overlaps = await page.eval(OVERLAPS);
      if (overlaps.length) throw new Error(`${beat.name}: overlapping UI ${JSON.stringify(overlaps)}`);
      const r = await page.eval(STATE);
      const { data } = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const png = Buffer.from(data, 'base64');
      const after = await page.eval('window.encore.tick()');
      if (after !== r.tick) throw new Error(`tick moved during capture of ${beat.name}: ${r.tick} -> ${after}`);
      if (r.tick !== beat.tick) throw new Error(`${beat.name}: paused on tick ${r.tick}, wanted ${beat.tick}`);
      const file = `gallery-${beat.n}-${beat.name}.png`;
      writeFileSync(join(OUT, file), png);
      console.log(`  ${file}: tick ${r.tick}, ${png.length} bytes`);
      captures.push({ file, sourceRevision: COMMIT, seed: 101, tick: r.tick, view: r.view, lenses: r.lenses, panels: r.panels,
        selectedDrone: r.selected, speedShown: r.speedShown, jams: r.jams, partitions: r.partitions, caption: beat.caption(r), run: beat.run, alive: r.alive,
        observer: r.samples, browser: chrome.version, gl, viewport: VIEWPORT, bytes: png.length, sha256: createHash('sha256').update(png).digest('hex') });
    };

    // 01: an independent run.
    await page.eval('window.encore.reset(101)');
    await page.eval(PAUSE_AT(BEATS[0].tick));
    await sleep(800);
    await shoot(BEATS[0]);

    // 02-06: one continuous scripted demo run.
    await page.goto(`${URL_}?seed=101&split=1`);
    await page.eval(WAIT_FOR_APP);
    await sleep(500);
    await page.eval('document.activeElement?.blur?.()');
    await page.key('d');
    for (const beat of BEATS.slice(1)) {
      const speed = await page.eval(PAUSE_AT(beat.tick));
      await sleep(900);                                   // the paused frame settles (render, chrome refresh)
      if (beat.deselect && (await page.eval(DESELECT)) !== null) throw new Error(`${beat.name}: could not clear the selection`);
      if (beat.metrics) { await page.key('m'); await sleep(800); }
      await sleep(300);
      await shoot(beat);
      if (beat.metrics) { await page.key('m'); await sleep(300); }
      await page.eval(`window.encore.setSpeed(${speed}); window.encore.setPlaying(true)`);
    }

    const captions = {
      schemaVersion: 1, issue: 141, supersedesPullRequest: 160, sourceRevision: COMMIT, seed: 101, viewport: VIEWPORT,
      browser: chrome.version, gl,
      processing: 'PNG bytes written exactly as Chrome returned them: no cropping, repainting, compositing or numeric edits.',
      captureMethod: 'node scripts/perf/gallery.mjs: headless Chrome via scripts/perf/cdp.mjs, --gl auto, refused on a software renderer. Beat 01 is an independent seed 101 run; 02-06 are one continuous scripted demo run (D). Paused on the exact tick; the show\'s own speed is restored before the screenshot; the tick is checked unchanged after it.',
      note: 'Numbers in captions and on screen are observer measurements of this demo run at that tick, not the evaluation matrix (results/RESULTS.md). nPWC uses our own slot priority order. Static ignoring an injected score is a capability difference, not a performance result.',
      captures,
    };
    writeFileSync(join(OUT, 'gallery-captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
    console.log(`Wrote ${captures.length} stills and gallery-captions.json to ${OUT}`);
  } finally {
    await chrome.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
