#!/usr/bin/env node
// scripts/perf/run.mjs
// QA harness for issue #94: performance numbers and screenshots of the real app in headless Chrome.
//
//   node scripts/perf/run.mjs                 build, serve, measure, write assets/qa/perf.{json,md}
//   node scripts/perf/run.mjs --shots         ... and capture the #94 screenshot states into assets/qa/<w>x<h>/
//   node scripts/perf/run.mjs --shots-only    screenshots only
//   node scripts/perf/run.mjs --gl probe      print the WebGL renderer under each graphics mode, then exit
//   options: --gl auto|swiftshader|vulkan|egl (default auto) · --url <running app> (skips build and serve)
//            --seconds N (measured window, default 10) · --warmup N (default 6) · --no-sim (skip the Node bench)
//            --only state,state (screenshot only these states, e.g. --only xray,jam)
//
// Works with both app shells: the readout is `.readout` in the stage-first shell (#113) and `.frame-readout` before it.
// Render fps (requestAnimationFrame) and simulation ticks per real second are measured separately and never mixed.
// A software renderer (SwiftShader, llvmpipe) is detected and reported as such: its numbers are never GPU numbers.
// See docs/demo/QA.md.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem, release, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, openPage, sleep } from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'assets', 'qa');
const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const option = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const GL = option('gl', 'auto');
const SECONDS = Number(option('seconds', 10));
const WARMUP = Number(option('warmup', 6));
const ONLY = option('only') ? option('only').split(',').map(s => s.trim()) : null;
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1280, height: 720 }];
const WINDOWS = platform() === 'win32';
const npm = WINDOWS ? 'npm.cmd' : 'npm';
const npx = WINDOWS ? 'npx.cmd' : 'npx';
const SHELL = { shell: WINDOWS };   // .cmd files need a shell on Windows

// ------------------------------------------------------------------------------------ the page side

/** The app's readout element: the new shell's `.readout` (#113) first, then the old `.frame-readout`. Both carry
 *  `data-fps` and, after a loop failure, `data-error`. */
const READOUT = `(document.querySelector('.readout') ?? document.querySelector('.frame-readout'))`;

/** A start-up failure the app reports on the page: `.error` (old shell) or a `.banner` saying WebGL failed (#113). */
const START_ERROR = `([...document.querySelectorAll('.error, .banner')].map(el => el.textContent ?? '').find(text => /could not start|error/i.test(text)) ?? null)`;

const WAIT_FOR_APP = `new Promise((resolve, reject) => {
  const start = performance.now();
  (function poll() {
    if (window.encore && typeof window.encore.tick === 'function' && window.encore.tick() > 0) return resolve(true);
    const error = ${START_ERROR};
    if (error) return reject(new Error(error));
    if (performance.now() - start > 20000) return reject(new Error('window.encore did not appear within 20 s'));
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

/** Frame deltas from requestAnimationFrame and the simulation tick before and after, over the same window. */
const MEASURE = seconds => `new Promise(resolve => {
  const deltas = [];
  const t0 = performance.now();
  const tick0 = window.encore.tick();
  let last = t0;
  requestAnimationFrame(function frame(now) {
    deltas.push(now - last);
    last = now;
    if (now - t0 < ${seconds * 1000}) return requestAnimationFrame(frame);
    const readout = ${READOUT};
    resolve({ elapsed: (performance.now() - t0) / 1000, ticks: window.encore.tick() - tick0, deltas: deltas.slice(1),
      appFps: readout?.dataset.fps ? Number(readout.dataset.fps) : null, loopError: readout?.dataset.error ?? null });
  });
})`;

// --------------------------------------------------------------------------------------------- server

async function serve() {
  const url = option('url');
  if (url) return { url, stop: () => {} };
  console.log('Building (npm run build)...');
  execFileSync(npm, ['run', 'build'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], ...SHELL });
  const child = spawn(npm, ['run', 'preview', '--', '--port', '4173', '--strictPort'], { cwd: ROOT, stdio: 'ignore', ...SHELL });
  const base = 'http://127.0.0.1:4173/';
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) return { url: base, stop: () => child.kill() }; } catch { /* not up yet */ }
    await sleep(200);
  }
  child.kill();
  throw new Error('vite preview did not answer on 127.0.0.1:4173 (is the port taken? pass --url)');
}

// ------------------------------------------------------------------------------------------- machine

function machine(chrome, glInfo) {
  const cpu = cpus();
  let wsl = false;
  try { wsl = /microsoft/i.test(readFileSync('/proc/version', 'utf8')); } catch { /* not Linux */ }
  let git = null;
  try { git = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim(); } catch { /* not a checkout */ }
  const software = !glInfo.webgl || SOFTWARE.test(`${glInfo.vendor} ${glInfo.renderer}`);
  return {
    cpu: cpu[0]?.model ?? 'unknown', logicalCores: cpu.length, memoryGb: Math.round(totalmem() / 2 ** 30),
    os: `${platform()} ${release()}${wsl ? ' (WSL)' : ''}`, node: process.version,
    browser: chrome.version, browserBinary: chrome.binary, glMode: GL, gl: glInfo,
    rendering: software ? 'software (no GPU number can be claimed from this run)' : 'hardware',
    git,
  };
}

// --------------------------------------------------------------------------------------------- perf

const SCENARIOS = [
  { name: 'single view', query: '', keys: [] },
  { name: 'single view + X-ray', query: '', keys: ['x'] },
  { name: 'split view', query: '&split=1', keys: [] },
  { name: 'split view + X-ray', query: '&split=1', keys: ['x'] },
];

function stats(deltas, elapsed, ticks) {
  const sorted = [...deltas].sort((a, b) => a - b);
  const pick = p => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  const r = v => Math.round(v * 100) / 100;
  return {
    renderFps: r(deltas.length / elapsed),
    frameMs: { p50: r(pick(50)), p95: r(pick(95)), max: r(sorted.at(-1)) },
    longFrames: deltas.filter(d => d > 50).length,
    simTicksPerSecond: r(ticks / elapsed),   // the target is 20 at 1x speed
  };
}

async function measure(chrome, url) {
  const results = [];
  for (const scenario of SCENARIOS) {
    const page = await openPage(chrome.browser, VIEWPORTS[0]);
    try {
      await page.goto(`${url}?seed=101${scenario.query}`);
      await page.eval(WAIT_FOR_APP);
      await sleep(WARMUP * 1000);
      for (const key of scenario.keys) await page.key(key);
      await sleep(500);
      const raw = await page.eval(MEASURE(SECONDS));
      const n0 = await page.eval(`window.encore.snapshots().encore.drones.length`);
      results.push({ scenario: scenario.name, url: `?seed=101${scenario.query}`, keys: scenario.keys, n0, seconds: Math.round(raw.elapsed * 100) / 100,
        ...stats(raw.deltas, raw.elapsed, raw.ticks), appReadoutFps: raw.appFps, loopError: raw.loopError });
      console.log(`  ${scenario.name}: ${results.at(-1).renderFps} fps, ${results.at(-1).simTicksPerSecond} ticks/s`);
    } catch (error) {
      results.push({ scenario: scenario.name, error: String(error) });
      console.log(`  ${scenario.name}: FAILED ${error}`);
    } finally {
      await page.close();
    }
  }
  return results;
}

async function demoPresence(chrome, url) {
  const page = await openPage(chrome.browser, VIEWPORTS[0]);
  try {
    await page.goto(`${url}?seed=101`);
    await page.eval(WAIT_FOR_APP);
    return await page.eval(`(() => {
      const button = [...document.querySelectorAll('button')].find(b => /run 90 s demo/i.test(b.textContent ?? ''));
      return { present: Boolean(button || (window.encore && 'demo' in window.encore)), how: button ? 'button' : window.encore && 'demo' in window.encore ? 'window.encore.demo' : null };
    })()`);
  } finally { await page.close(); }
}

function simBench() {
  try {
    const out = execFileSync(npx, ['tsx', 'scripts/perf/simBench.ts'], { cwd: ROOT, env: { ...process.env }, ...SHELL }).toString();
    return JSON.parse(out.trim().split('\n').at(-1));
  } catch (error) {
    return { error: String(error).slice(0, 500) };
  }
}

// ---------------------------------------------------------------------------------------- screenshots

/** The #94 state list. `available` decides from the live DOM whether this build can show the state at all. */
const STATES = [
  { name: 'default-stage', note: 'ENCORE formation in hold', run: async () => {} },
  { name: 'xray', note: 'X-ray on (key X): radio events actually sent', run: async p => { await p.key('x'); await sleep(1500); } },
  { name: 'split', query: '&split=1', note: 'Encore above, static below, one camera', run: async () => {} },
  { name: 'failure', note: 'region of radius 6 m killed around drone 100, 12 s later', run: async p => {
    await p.eval(`window.encore.killRegion(window.encore.snapshots().encore.drones[100].pos, 6)`); await sleep(12000);
  } },
  { name: 'jam', note: 'drone 100 selected by a click, then J: jam around it', run: async p => { await selectDrone(p, 100); await p.key('j'); await sleep(3000); } },
  { name: 'active-injection', note: 'drone 100 selected, I injects the panel composition, C shows belief colours', run: async p => {
    await selectDrone(p, 100); await p.key('c'); await p.key('i'); await sleep(4000);
  } },
  { name: 'version-divergence', note: 'jam around drone 100, then inject into drone 20 outside it, belief colours on', run: async p => {
    await selectDrone(p, 100); await p.key('j'); await sleep(1000); await selectDrone(p, 20); await p.key('c'); await p.key('i'); await sleep(5000);
  } },
  // These need the new shell (#92) or #27. `shown` is checked AFTER the setup step and needs a visible element, so a
  // module that is loaded but not connected (the inspector panel stays hidden until main.ts connects it) is not
  // mistaken for the feature. Selectors are exact names, never fragments that the old control panel also matches.
  { name: 'inspector', note: 'drone 100 selected by a click', run: async p => { await selectDrone(p, 100); await sleep(1500); }, shown: visible('[aria-label="Drone inspector"]') },
  { name: 'composer', note: 'composer panel open', run: async p => { await p.key('f'); await sleep(800); }, shown: visible('[aria-label="Formation composer"], [aria-label="Composer"], .composer') },
  { name: 'console', note: 'console tray open', run: async p => { await p.key('`'); await sleep(800); }, shown: visible('[aria-label="Console"], .console') },
  { name: 'timeline', note: 'Show timeline tray open', run: async p => { await p.key('t'); await sleep(800); }, shown: visible('[aria-label="Show timeline"]') },
  { name: 'scripted-demo', note: 'scripted demo running', run: async p => { await p.key('d'); await sleep(5000); }, shown: `Boolean([...document.querySelectorAll('button')].find(b => /stop demo/i.test(b.textContent ?? '') && b.offsetParent !== null))` },
];

/** A page expression: true if an element matching `selector` exists and is laid out (not hidden). */
function visible(selector) {
  return `Boolean([...document.querySelectorAll(${JSON.stringify(selector)})].find(el => !el.hidden && el.getClientRects().length > 0))`;
}

async function selectDrone(page, id) {
  const at = await page.eval(`window.encore.screenOf(${id})`);
  if (!at) throw new Error(`drone ${id} is not on screen`);
  await page.click(at[0], at[1]);
  await sleep(300);
}

/**
 * What the app itself says about its brains. The old shell shows it in `.preview-badge`. The stage-first shell
 * (#113) shows it only in the Metrics popover's "Brains" row, so open Metrics (M), read the row and close it
 * (Escape). Called after the screenshot, so the captured state is never changed.
 */
async function brainLabel(page) {
  const badge = await page.eval(`document.querySelector('.preview-badge')?.textContent ?? null`);
  if (badge) return badge;
  // In the console and composer states a text input has focus, so 'm' would be typed into it instead of opening Metrics.
  await page.eval(`document.activeElement?.blur?.()`);
  await page.key('m');
  await sleep(400);
  const row = await page.eval(`(() => {
    const row = [...document.querySelectorAll('div')].find(d => d.firstChild?.nodeType === 3 && d.firstChild.textContent.trim() === 'Brains');
    return row ? 'Brains: ' + (row.querySelector('b')?.textContent ?? '?') : null;
  })()`);
  await page.key('Escape');
  return row;
}

async function screenshots(chrome, url) {
  const manifest = [];
  for (const viewport of VIEWPORTS) {
    const dir = join(OUT, `${viewport.width}x${viewport.height}`);
    mkdirSync(dir, { recursive: true });
    for (const state of STATES.filter(s => !ONLY || ONLY.includes(s.name))) {
      const page = await openPage(chrome.browser, viewport);
      const entry = { state: state.name, viewport: `${viewport.width}x${viewport.height}`, url: `?seed=101${state.query ?? ''}` };
      try {
        await page.goto(`${url}?seed=101${state.query ?? ''}`);
        await page.eval(WAIT_FOR_APP);
        // Hold of the first formation (ENCORE) starts at tick 241; wait until the swarm is there.
        await page.eval(`new Promise(r => (function w() { window.encore.tick() >= 300 ? r() : setTimeout(w, 200); })())`);
        await state.run(page);
        if (state.shown && !(await page.eval(state.shown))) {
          manifest.push({ ...entry, captured: false, reason: 'not shown in this build (needs the new shell #92, or #27 for the demo)' });
          continue;
        }
        const png = await page.screenshot();
        const file = join(dir, `${state.name}.png`);
        writeFileSync(file, png);
        const tick = await page.eval('window.encore.tick()');
        const badge = await brainLabel(page);   // after the screenshot: it may open and close the Metrics popover
        manifest.push({ ...entry, captured: true, file: file.slice(ROOT.length + 1).replaceAll('\\', '/'), tick, note: state.note ?? '', badge, bytes: png.length });
      } catch (error) {
        manifest.push({ ...entry, captured: false, reason: String(error) });
      } finally {
        await page.close();
        console.log(`  ${entry.viewport} ${state.name}: ${manifest.at(-1)?.captured ? 'captured' : manifest.at(-1)?.reason}`);
      }
    }
  }
  return manifest;
}

// ------------------------------------------------------------------------------------------- report

function markdown(report) {
  const m = report.machine;
  const lines = [
    `# Encore QA run ${report.startedAt}`, '',
    `Generated by \`node scripts/perf/run.mjs\`. How to read it: [docs/demo/QA.md](../../docs/demo/QA.md).`, '',
    '## Machine', '',
    `- CPU: ${m.cpu}, ${m.logicalCores} logical cores, ${m.memoryGb} GB`,
    `- OS: ${m.os}; Node ${m.node}; ${m.browser} (headless, \`--gl ${m.glMode}\`)`,
    `- WebGL: ${m.gl.webgl ? `${m.gl.vendor} / ${m.gl.renderer}` : 'unavailable'}`,
    `- **Rendering: ${m.rendering}**`,
    `- App revision: ${m.git ?? 'unknown'}`, '',
  ];
  if (report.browser) {
    lines.push('## Browser: render and simulation, measured separately', '',
      `${report.settings.seconds} s measured after ${report.settings.warmup} s warm-up, seed 101, 1440×900. Render fps counts requestAnimationFrame callbacks; sim ticks/s is the change in \`window.encore.tick()\` per real second (target 20 at 1× speed).`, '',
      '| Scenario | Drones | Render fps | Frame ms p50 / p95 / max | Frames > 50 ms | Sim ticks/s | App readout fps |', '|---|---|---|---|---|---|---|');
    for (const r of report.browser) {
      lines.push(r.error ? `| ${r.scenario} | | **failed:** ${r.error} | | | | |`
        : `| ${r.scenario} | ${r.n0} | ${r.renderFps} | ${r.frameMs.p50} / ${r.frameMs.p95} / ${r.frameMs.max} | ${r.longFrames} | ${r.simTicksPerSecond} | ${r.appReadoutFps ?? '—'}${r.loopError ? ` (loop stopped: ${r.loopError})` : ''} |`);
    }
    if (/software/.test(m.rendering)) lines.push('', '> Software rendering: these fps describe the CPU rasteriser on this machine. They are **not** a GPU or demo-laptop number.');
    lines.push('', '**100 vs 200 drones in the browser: not measurable.** The app has no roster option; it always builds 200. See the Node table for the simulation cost at 100 and 200.', '');
  }
  if (report.simulation) {
    lines.push('## Node: simulation step cost without rendering', '');
    if (report.simulation.error) lines.push(`Failed: ${report.simulation.error}`, '');
    else {
      lines.push(`One \`worlds.stepBoth()\` = both worlds and both observers, as the app's advance() does. ${report.simulation.results[0]?.ticks} ticks after ${report.simulation.results[0]?.fromTick - 1} warm-up ticks, seed 101, Node ${report.simulation.node}.`, '',
        '| Drones | Encore-arm brain | stepBoth ms mean / p50 / p95 / max | Max ticks/s (sim only) |', '|---|---|---|---|');
      for (const r of report.simulation.results) lines.push(`| ${r.n0} | ${r.encoreArmBrain} | ${r.stepBothMs.mean} / ${r.stepBothMs.p50} / ${r.stepBothMs.p95} / ${r.stepBothMs.max} | ${r.maxTicksPerSecond} |`);
      lines.push('');
    }
  }
  if (report.demo) lines.push('## Scripted demo', '', report.demo.present ? `Present (${report.demo.how}); its duration is not timed by this version of the harness.` : 'Not in this build (#27), so no duration.', '');
  if (report.screenshots) {
    lines.push('## Screenshots', '', 'PNG files are git-ignored (`assets/qa/.gitignore`); regenerate them with `--shots`. "App badge" is what the app itself says about its brains at capture time.', '',
      '| Viewport | State | Result | App badge |', '|---|---|---|---|');
    for (const s of report.screenshots) lines.push(`| ${s.viewport} | ${s.state} | ${s.captured ? `\`${s.file}\` at tick ${s.tick}${s.note ? `: ${s.note}` : ''}` : `not captured: ${s.reason}`} | ${s.badge ?? ''} |`);
    lines.push('');
  }
  return lines.join('\n');
}

// --------------------------------------------------------------------------------------------- main

async function probe() {
  for (const gl of ['auto', 'swiftshader', 'vulkan', 'egl']) {
    let chrome;
    try {
      chrome = await launch({ gl, width: 800, height: 600 });
      const page = await openPage(chrome.browser, { width: 800, height: 600 });
      await page.goto('data:text/html,<p>probe</p>');
      const info = await page.eval(GL_INFO);
      console.log(`${gl.padEnd(12)} ${info.webgl ? `${info.vendor} / ${info.renderer}` : 'no WebGL'}${info.webgl && SOFTWARE.test(`${info.vendor} ${info.renderer}`) ? '  [software]' : ''}`);
    } catch (error) {
      console.log(`${gl.padEnd(12)} failed: ${String(error).slice(0, 200)}`);
    } finally {
      await chrome?.close();
    }
  }
}

/** `--only` must name screenshot states that exist, or the run would silently capture nothing. */
function checkOnly() {
  if (!argv.includes('--only')) return;
  const names = STATES.map(s => s.name);
  const value = option('only');
  const unknown = !value || value.startsWith('--') ? null : ONLY.filter(name => !names.includes(name));
  if (unknown && unknown.length === 0) return;
  console.error(unknown ? `--only: unknown state ${unknown.map(n => `"${n}"`).join(', ')}.` : '--only needs a value.');
  console.error(`Valid states: ${names.join(', ')}`);
  process.exit(1);
}

async function main() {
  checkOnly();
  if (GL === 'probe') return probe();
  const startedAt = new Date().toISOString();
  const server = await serve();
  const chrome = await launch({ ...VIEWPORTS[0], gl: GL });
  const report = { startedAt, settings: { seconds: SECONDS, warmup: WARMUP, gl: GL, url: server.url } };
  try {
    const page = await openPage(chrome.browser, VIEWPORTS[0]);
    await page.goto(server.url);
    report.machine = machine(chrome, await page.eval(GL_INFO));
    await page.close();
    console.log(`Rendering: ${report.machine.rendering} (${report.machine.gl.renderer ?? 'no WebGL'})`);
    if (!flag('shots-only')) {
      console.log('Measuring the browser...');
      report.browser = await measure(chrome, server.url);
      report.demo = await demoPresence(chrome, server.url);
      if (!flag('no-sim')) { console.log('Measuring the simulation in Node...'); report.simulation = simBench(); }
    }
    if (flag('shots') || flag('shots-only')) { console.log('Capturing screenshots...'); report.screenshots = await screenshots(chrome, server.url); }
  } finally {
    await chrome.close();
    server.stop();
  }
  mkdirSync(OUT, { recursive: true });
  const name = flag('shots-only') ? 'shots' : 'perf';
  writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(OUT, `${name}.md`), `${markdown(report)}\n`);
  console.log(`Wrote assets/qa/${name}.json and assets/qa/${name}.md`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
