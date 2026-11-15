// docs/assets/readme/make-hero.mjs
// Generates encore-hero.svg, the README banner. Run from the repo root:
//   npx tsx docs/assets/readme/make-hero.mjs
//
// The wordmark is lit with Encore's own 5x7 formation font (src/score/font.ts): each dot is one cell
// a text formation would give a drone. Colours are the app's: the default text palette (amber to rose,
// src/score/shapes.ts), the stage background and the overlay colours of src/app/ui/styles.css and the
// render layers (lost drone cross, vacant slot, in-transit tether, claim). The repair vignette in the
// "O" is an illustration of the mechanism, not a frame captured from a run.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLYPH_ADVANCE, GLYPH_ROWS, litCells } from '../../../src/score/font.ts';

const W = 1600;
const H = 560;
const WORD = 'ENCORE';
const PITCH = 34;
const COLS = WORD.length * GLYPH_ADVANCE - 1;
const X0 = (W - (COLS - 1) * PITCH) / 2;
const TOP = 128;

const BG = '#03080e';
const MUTED = '#7f99a6';
const LINE = '#172f3b';
const GRID = '#183d4d';
const VACANT = '#ff5a1f';
const TRANSIT = '#ffb547';
const CLAIM = '#38e1f0';
const SCORE = '#ff4fd8';
const LOST = '#637783';
const SLOT = '#5d7482';

const AMBER = [1, 0.72, 0.2];
const ROSE = [1, 0.32, 0.5];
const hex = rgb => '#' + rgb.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const fx = n => Number(n.toFixed(1));

const pos = cell => ({ x: fx(X0 + cell.x * PITCH), y: fx(TOP + (GLYPH_ROWS - 1 - cell.y) * PITCH) });
const key = cell => `${cell.x},${cell.y}`;

// The "O" is the fourth glyph: columns 18-22. Two drones on its left stroke are lost; one neighbour
// from the inner edge of the "C" is on its way to the more important of the two vacated slots.
const O = 3 * GLYPH_ADVANCE;
const lost = [{ x: O, y: 3 }, { x: O, y: 2 }];
const mover = { x: 2 * GLYPH_ADVANCE + 4, y: 1 };    // lower-right cell of the "C"
const moverNow = { x: X0 + (O - 0.9) * PITCH, y: TOP + (GLYPH_ROWS - 1 - 2.55) * PITCH };
const lostKeys = new Set(lost.map(key));

const out = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">`);
out.push(`<title id="t">Encore</title>`);
out.push(`<desc id="d">The word ENCORE drawn as a formation of luminous drone dots using Encore's own formation font. In the letter O two drones are lost; their slots show as vacant rings and a neighbouring drone flies in to claim one.</desc>`);
out.push(`<defs>
  <radialGradient id="glow" cx="50%" cy="46%" r="60%"><stop offset="0" stop-color="#0d2230" stop-opacity="0.9"/><stop offset="1" stop-color="${BG}" stop-opacity="0"/></radialGradient>
  <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BG}" stop-opacity="1"/><stop offset="0.25" stop-color="${BG}" stop-opacity="0"/></linearGradient>
  <filter id="bloom" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
  <clipPath id="frame"><rect width="${W}" height="${H}" rx="22"/></clipPath>
</defs>`);
out.push(`<g clip-path="url(#frame)">`);
out.push(`<rect width="${W}" height="${H}" fill="${BG}"/>`);
out.push(`<rect width="${W}" height="${H}" fill="url(#glow)"/>`);

// Perspective floor grid, like the stage's GridHelper.
const horizon = 436;
const vx = W / 2;
const grid = [];
for (let i = -16; i <= 16; i++) grid.push(`M${fx(vx + i * 14)} ${horizon}L${fx(vx + i * 150)} ${H}`);
for (let k = 1; k <= 6; k++) { const y = fx(horizon + (H - horizon) * (k / 6) ** 1.7); grid.push(`M0 ${y}H${W}`); }
out.push(`<path d="${grid.join('')}" stroke="${GRID}" stroke-width="1" opacity="0.55" fill="none"/>`);
out.push(`<rect y="${horizon}" width="${W}" height="${H - horizon}" fill="url(#floor)"/>`);

// Faint score ripple around one drone of the final "E": a new score version spreading by radio.
const rippleAt = pos({ x: 5 * GLYPH_ADVANCE + 4, y: 6 });
for (const [r, o] of [[24, 0.5], [44, 0.3], [66, 0.16]]) {
  out.push(`<circle cx="${rippleAt.x}" cy="${rippleAt.y}" r="${r}" fill="none" stroke="${SCORE}" stroke-width="1.4" opacity="${o}"/>`);
}

// Drones of the formation.
const drones = [];
const halos = [];
for (const cell of litCells(WORD)) {
  if (lostKeys.has(key(cell)) || key(cell) === key(mover)) continue;
  const p = pos(cell);
  const c = hex(lerp(AMBER, ROSE, cell.x / (COLS - 1)));
  halos.push(`<circle cx="${p.x}" cy="${p.y}" r="8" fill="${c}"/>`);
  drones.push(`<circle cx="${p.x}" cy="${p.y}" r="5.4" fill="${c}"/><circle cx="${p.x - 1}" cy="${p.y - 1}" r="1.9" fill="#fff" opacity="0.75"/>`);
}
out.push(`<g filter="url(#bloom)" opacity="0.75">${halos.join('')}</g>`);
out.push(`<g>${drones.join('')}</g>`);

// Repair vignette.
const from = pos(mover);
const target = pos(lost[0]);
const moverColour = hex(lerp(AMBER, ROSE, mover.x / (COLS - 1)));
out.push(`<circle cx="${from.x}" cy="${from.y}" r="7" fill="none" stroke="${SLOT}" stroke-width="1.5" stroke-dasharray="2 3"/>`);
out.push(`<path d="M${from.x} ${from.y}L${fx(moverNow.x)} ${fx(moverNow.y)}" stroke="${TRANSIT}" stroke-width="1.6" stroke-dasharray="4 4" opacity="0.6"/>`);
out.push(`<path d="M${fx(moverNow.x)} ${fx(moverNow.y)}L${target.x} ${target.y}" stroke="${TRANSIT}" stroke-width="2"/>`);
for (const cell of lost) {
  const p = pos(cell);
  out.push(`<circle cx="${p.x}" cy="${p.y}" r="10" fill="none" stroke="${VACANT}" stroke-width="2"/>`);
  out.push(`<path d="M${p.x - 4} ${p.y - 4}L${p.x + 4} ${p.y + 4}M${p.x + 4} ${p.y - 4}L${p.x - 4} ${p.y + 4}" stroke="${LOST}" stroke-width="1.6"/>`);
}
for (const [r, o] of [[16, 0.7], [27, 0.35]]) {
  out.push(`<circle cx="${fx(moverNow.x)}" cy="${fx(moverNow.y)}" r="${r}" fill="none" stroke="${CLAIM}" stroke-width="1.4" opacity="${o}"/>`);
}
out.push(`<circle cx="${fx(moverNow.x)}" cy="${fx(moverNow.y)}" r="8" fill="${moverColour}" filter="url(#bloom)" opacity="0.75"/><circle cx="${fx(moverNow.x)}" cy="${fx(moverNow.y)}" r="5.2" fill="${moverColour}"/><circle cx="${fx(moverNow.x - 1)}" cy="${fx(moverNow.y - 1)}" r="1.9" fill="#fff" opacity="0.8"/>`);

// Labels: one line of context top-left, a legend bottom-left. Monospace, the app's muted text colour.
const MONO = `font-family="'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"`;
out.push(`<text x="56" y="70" ${MONO} font-size="22" letter-spacing="3" fill="${MUTED}">DURHACK 2026 · SIMULATED · NO CONDUCTOR DURING THE SHOW</text>`);
const ly = H - 40;
const legend = [];
let lx = 56;
const item = (shape, label) => { legend.push(shape(lx + 10, ly - 8)); legend.push(`<text x="${lx + 32}" y="${ly}" ${MONO} font-size="23" fill="${MUTED}">${label}</text>`); lx += 32 + label.length * 13.9 + 28; };
item((x, y) => `<circle cx="${x}" cy="${y}" r="7.5" fill="${hex(AMBER)}"/>`, 'drone');
item((x, y) => `<path d="M${x - 6} ${y - 6}L${x + 6} ${y + 6}M${x + 6} ${y - 6}L${x - 6} ${y + 6}" stroke="${LOST}" stroke-width="2.2"/>`, 'lost');
item((x, y) => `<circle cx="${x}" cy="${y}" r="9" fill="none" stroke="${VACANT}" stroke-width="2"/>`, 'vacant slot');
item((x, y) => `<path d="M${x - 12} ${y}H${x + 12}" stroke="${TRANSIT}" stroke-width="3"/>`, 'en route to claim it');
item((x, y) => `<circle cx="${x}" cy="${y}" r="9" fill="none" stroke="${CLAIM}" stroke-width="2"/>`, 'claim on radio');
item((x, y) => `<circle cx="${x}" cy="${y}" r="9" fill="none" stroke="${SCORE}" stroke-width="2"/>`, 'new score spreading');
out.push(`<g>${legend.join('')}</g>`);
out.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="22" fill="none" stroke="${LINE}"/>`);
out.push(`</g></svg>`);

const file = join(dirname(fileURLToPath(import.meta.url)), 'encore-hero.svg');
writeFileSync(file, out.join('\n') + '\n');
console.log(`wrote ${file}`);
