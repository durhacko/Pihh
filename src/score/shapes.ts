// src/score/shapes.ts
// Step 1 of recipe expansion (contract section 6): point clouds of each shape, in the shape's own
// unit coordinates. expandRecipe picks slots from the selection cloud, then scales and places everything.
import type { Recipe, RGB, Vec3 } from '../contracts';
import { GLYPH_COLS, GLYPH_ROWS, litCells } from './font';
import type { Cell } from './font';

/** Helix proportions, in radii. Squat on purpose: the scaled formation must stay above y = 2. */
export const HELIX_TURNS = 2;
export const HELIX_HEIGHT = 2.5;

const TEXT_SUPERSAMPLE = 3;        // each lit cell becomes 3x3 candidates
const TEXT_SLOTS_PER_CELL = 8;     // more slots per lit cell than this and the text gets a second layer
const TEXT_LAYER_GAP = 0.5;        // distance between layers, in cells
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// Coordinates are snapped to a 1e-9 grid. Math.sin and Math.cos may differ in the last bit between
// JavaScript engines; after snapping, every later step is plain arithmetic and sqrt, which are exact
// IEEE operations, so tie-breaks in the slot order come out the same everywhere.
const snap = (v: number): number => Math.round(v * 1e9) / 1e9;

function sphere(count: number): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * GOLDEN_ANGLE;
    points.push([snap(r * Math.cos(phi)), snap(y), snap(r * Math.sin(phi))]);
  }
  return points;
}

function helix(count: number): Vec3[] {
  const perStrand = Math.max(1, Math.ceil(count / 2));
  const points: Vec3[] = [];
  for (let strand = 0; strand < 2; strand++) {
    for (let j = 0; j < perStrand; j++) {
      const t = (j + 0.5) / perStrand;
      const theta = 2 * Math.PI * HELIX_TURNS * t + strand * Math.PI;
      points.push([snap(Math.cos(theta)), snap(HELIX_HEIGHT * (t - 0.5)), snap(Math.sin(theta))]);
    }
  }
  return points;
}

/** Text with no lit cell (empty, or only spaces and unknown characters) is shown as one solid 5x7 block. */
function cellsOf(text: string): Cell[] {
  const cells = litCells(text);
  if (cells.length > 0) return cells;
  for (let row = 0; row < GLYPH_ROWS; row++) {
    for (let col = 0; col < GLYPH_COLS; col++) cells.push({ x: col, y: GLYPH_ROWS - 1 - row });
  }
  return cells;
}

/**
 * How many copies of the text stand behind each other (along z). Almost always 1. Slots keep a fixed
 * spacing, so a very short text flown by a large roster (one letter, 200 drones) would have to grow
 * until it reached below the ground. Extra layers keep its height bounded; from the front it reads the same.
 */
export function textLayers(litCount: number, n0: number): number {
  return Math.max(1, Math.ceil(n0 / (TEXT_SLOTS_PER_CELL * litCount)));
}

function textPoints(cells: Cell[], layers: number, sub: number): Vec3[] {
  const points: Vec3[] = [];
  for (let layer = 0; layer < layers; layer++) {
    const z = snap((layer - (layers - 1) / 2) * TEXT_LAYER_GAP);
    for (const cell of cells) {
      for (let j = 0; j < sub; j++) {
        for (let i = 0; i < sub; i++) {
          points.push([snap(cell.x + (i + 0.5) / sub), snap(cell.y + 1 - (j + 0.5) / sub), z]);
        }
      }
    }
  }
  return points;
}

/**
 * The candidate cloud for slot selection: about `count` points (expandRecipe asks for 4 * n0).
 * Text supersamples each lit cell 3x3, and more finely only when that would give fewer than `count`
 * points, so a short text still has enough distinct candidates for a large roster.
 */
export function selectionCloud(recipe: Recipe, n0: number, count: number): Vec3[] {
  switch (recipe.kind) {
    case 'text': {
      const cells = cellsOf(recipe.text);
      const layers = textLayers(cells.length, n0);
      const sub = Math.max(TEXT_SUPERSAMPLE, Math.ceil(Math.sqrt(count / (cells.length * layers))));
      return textPoints(cells, layers, sub);
    }
    case 'sphere': return sphere(count);
    case 'helix': return helix(count);
  }
}

/** The dense target shape: about `count` points on the same shape, in the same unit coordinates. */
export function denseCloud(recipe: Recipe, n0: number, count: number): Vec3[] {
  switch (recipe.kind) {
    case 'text': {
      const cells = cellsOf(recipe.text);
      const layers = textLayers(cells.length, n0);
      const sub = Math.max(1, Math.round(Math.sqrt(count / (cells.length * layers))));
      return textPoints(cells, layers, sub);
    }
    case 'sphere': return sphere(count);
    case 'helix': return helix(count);
  }
}

/** Default two-colour gradient per kind (left to right). None is pure blue, which reads as dark on screen. */
export function defaultPalette(kind: Recipe['kind']): [RGB, RGB] {
  switch (kind) {
    case 'text': return [[1, 0.72, 0.2], [1, 0.32, 0.5]];          // amber to rose
    case 'sphere': return [[0.25, 0.95, 0.8], [0.7, 0.45, 1]];     // aqua to violet
    case 'helix': return [[0.4, 1, 0.5], [1, 0.9, 0.3]];           // spring green to gold
  }
}
