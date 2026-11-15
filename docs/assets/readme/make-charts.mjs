// docs/assets/readme/make-charts.mjs
// Generates s2-recovery.svg for the README from the committed run records. Run from the repo root:
//   node docs/assets/readme/make-charts.mjs
//
// Source: results/S2_n200_{static,encore}_s{1..5}.json (minimum matrix, evidence freeze 0b2f8f3, see results/RESULTS.md).
// Every plotted value is a MetricsSample from those records (one sample every 5 ticks = 0.25 s). Nothing is
// smoothed or interpolated: lines join consecutive samples; the band is the min-max across the 5 seeds and the
// line is the median. Window: ticks 300-895 (15-44.75 s), the hold of formation A that contains the kill at 20 s.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, '..', '..', '..', 'results');
const SEEDS = [1, 2, 3, 4, 5];
const T0 = 300;
const T1 = 895;
const DT = 0.05;

// Validated with the dataviz palette checker on the stage surface #03080e (dark): lightness band, chroma floor,
// CVD and normal-vision separation, and 3:1 contrast all pass.
const ARMS = [
  { key: 'static', label: 'Static baseline', colour: '#3d8fd1' },
  { key: 'encore', label: 'Encore', colour: '#c98420' },
];
const BG = '#03080e';
const LINE = '#172f3b';
const GRID = '#132833';
const TEXT = '#e2eef3';
const TEXT2 = '#a9bec8';
const TEXT3 = '#7f99a6';
const SANS = `font-family="Inter, 'Segoe UI', Helvetica, Arial, sans-serif"`;
const MONO = `font-family="'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"`;

const records = {};
for (const arm of ARMS) {
  records[arm.key] = SEEDS.map(seed => {
    const r = JSON.parse(readFileSync(join(RESULTS, `S2_n200_${arm.key}_s${seed}.json`), 'utf8'));
    if (r.scenario !== 'S2' || r.arm !== arm.key || r.seed !== seed) throw new Error(`unexpected record ${arm.key} s${seed}`);
    return r;
  });
}
const kill = records.static[0].events.find(e => e.type === 'KILL');
const git = records.static[0].git;
for (const arm of ARMS) for (const r of records[arm.key]) if (r.git !== git) throw new Error('records span more than one commit');

const median = xs => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function band(armKey, field) {
  const rows = [];
  const bySeed = records[armKey].map(r => new Map(r.series.map(s => [s.tick, s[field]])));
  for (let t = T0; t <= T1; t += 5) {
    const xs = bySeed.map(m => m.get(t)).filter(v => typeof v === 'number');
    if (xs.length !== SEEDS.length) throw new Error(`missing ${field} at tick ${t} for ${armKey}`);
    rows.push({ t, lo: Math.min(...xs), hi: Math.max(...xs), mid: median(xs) });
  }
  return rows;
}

const W = 1600;
const H = 640;
const PANEL_W = 660;
const PANEL_H = 330;
const PANELS = [
  { x: 110, field: 'npwc', title: 'Priority-weighted coverage (nPWC)', unit: '', yMin: 0.85, yMax: 1.0, ticks: [0.85, 0.9, 0.95, 1.0], fmt: v => v.toFixed(2),
    note: 'Weighted by our own slot priorities; 1.0 = the best the survivors could do. Plain coverage ties at 0.90.', threshold: 0.95 },
  { x: 870, field: 'sfMax', title: 'Largest gap in the picture (sfMax, metres)', unit: ' m', yMin: 0, yMax: 10, ticks: [0, 2, 4, 6, 8, 10], fmt: v => String(v),
    note: 'Label-independent: the farthest any point of the target shape is from a live drone. Lower is better.' },
];
const TOP = 150;
const sx = t => (t - T0) / (T1 - T0) * PANEL_W;
const fx = n => Number(n.toFixed(1));

const out = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">`);
out.push(`<title id="t">S2 regional kill: Encore against the static baseline</title>`);
out.push(`<desc id="d">Two line charts over 15 to 45 seconds of scenario S2, 200 drones, seeds 1 to 5. At 20 seconds 20 neighbouring drones are killed. Static baseline nPWC drops to about 0.91 and stays there; Encore climbs back to about 0.97 within 10 to 15 seconds. The largest gap in the picture jumps to about 6.5 to 8.6 metres for the static baseline and stays; for Encore it falls back to about 2.2 to 2.4 metres.</desc>`);
out.push(`<rect width="${W}" height="${H}" rx="22" fill="${BG}"/><rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="22" fill="none" stroke="${LINE}"/>`);
out.push(`<text x="56" y="62" ${MONO} font-size="14" letter-spacing="2.5" fill="${TEXT3}">S2 · REGIONAL KILL · 200 DRONES · SEEDS 1–5 · MEDIAN AND MIN–MAX</text>`);
out.push(`<text x="56" y="100" ${SANS} font-size="26" fill="${TEXT}">20 neighbouring drones die at 20 s. Encore's survivors refill the important slots; the static show keeps the hole.</text>`);

// Legend, top right: coloured mark beside text-coloured label.
let lx = W - 56;
for (const arm of [...ARMS].reverse()) {
  const w = arm.label.length * 8.4 + 34;
  lx -= w;
  out.push(`<rect x="${lx}" y="51" width="18" height="4" rx="2" fill="${arm.colour}"/><text x="${lx + 26}" y="58" ${SANS} font-size="15" fill="${TEXT2}">${arm.label}</text>`);
  lx -= 18;
}

for (const p of PANELS) {
  const sy = v => PANEL_H - (v - p.yMin) / (p.yMax - p.yMin) * PANEL_H;
  const g = [`<g transform="translate(${p.x} ${TOP})">`];
  g.push(`<text x="0" y="-18" ${SANS} font-size="17" fill="${TEXT}">${p.title}</text>`);
  for (const v of p.ticks) {
    g.push(`<path d="M0 ${fx(sy(v))}H${PANEL_W}" stroke="${GRID}" stroke-width="1"/>`);
    g.push(`<text x="-12" y="${fx(sy(v)) + 5}" text-anchor="end" ${MONO} font-size="13" fill="${TEXT3}">${p.fmt(v)}</text>`);
  }
  for (const s of [15, 20, 25, 30, 35, 40, 45]) {
    const x = fx(sx(Math.min(s / DT, T1)));
    g.push(`<text x="${x}" y="${PANEL_H + 24}" text-anchor="middle" ${MONO} font-size="13" fill="${TEXT3}">${s} s</text>`);
  }
  // Kill marker.
  const kx = fx(sx(kill.tick));
  g.push(`<path d="M${kx} -4V${PANEL_H}" stroke="${TEXT3}" stroke-width="1.2" stroke-dasharray="3 4"/>`);
  g.push(`<text x="${kx + 8}" y="12" ${MONO} font-size="12" fill="${TEXT2}">KILL ×${kill.ids.length}</text>`);
  if (p.threshold) {
    const ty = fx(sy(p.threshold));
    g.push(`<path d="M0 ${ty}H${PANEL_W}" stroke="${TEXT3}" stroke-width="1" stroke-dasharray="1 5" stroke-linecap="round"/>`);
    g.push(`<text x="${kx + 8}" y="${ty + 18}" ${SANS} font-size="12.5" fill="${TEXT3}">recovery 0.95</text>`);
  }
  for (const arm of ARMS) {
    const rows = band(arm.key, p.field);
    const clamp = v => Math.max(p.yMin, Math.min(p.yMax, v));
    const upper = rows.map(r => `${fx(sx(r.t))} ${fx(sy(clamp(r.hi)))}`);
    const lower = rows.map(r => `${fx(sx(r.t))} ${fx(sy(clamp(r.lo)))}`).reverse();
    g.push(`<path d="M${upper.join('L')}L${lower.join('L')}Z" fill="${arm.colour}" opacity="0.18"/>`);
    g.push(`<path d="M${rows.map(r => `${fx(sx(r.t))} ${fx(sy(clamp(r.mid)))}`).join('L')}" fill="none" stroke="${arm.colour}" stroke-width="2.4" stroke-linejoin="round"/>`);
    const last = rows.at(-1);
    g.push(`<circle cx="${fx(sx(last.t))}" cy="${fx(sy(clamp(last.mid)))}" r="4.5" fill="${arm.colour}" stroke="${BG}" stroke-width="2"/>`);
    g.push(`<text x="${fx(sx(last.t)) + 12}" y="${fx(sy(clamp(last.mid))) + 5}" ${MONO} font-size="13.5" fill="${TEXT}">${p.field === 'npwc' ? last.mid.toFixed(3) : `${last.mid.toFixed(1)} m`}</text>`);
  }
  g.push(`<path d="M0 ${PANEL_H}H${PANEL_W}" stroke="${TEXT3}" stroke-width="1" opacity="0.6"/>`);
  g.push(`<text x="0" y="${PANEL_H + 58}" ${SANS} font-size="13.5" fill="${TEXT3}">${p.note}</text>`);
  g.push(`</g>`);
  out.push(g.join(''));
}
out.push(`<text x="56" y="${H - 30}" ${MONO} font-size="12" fill="${TEXT3}">Source: results/S2_n200_*_s1-5.json · git ${git.slice(0, 7)} · one sample per 0.25 s, unsmoothed · generated by docs/assets/readme/make-charts.mjs</text>`);
out.push(`</svg>`);

const file = join(HERE, 's2-recovery.svg');
writeFileSync(file, out.join('\n') + '\n');
console.log(`wrote ${file}`);
