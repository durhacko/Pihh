// P2-WP-09 / P2-T13: the inspector peer diff. Raw data only: per peer, the age of the drone's own last record of it
// (from World.inspect().state) beside observer truth. No label derived from brain rules ("believed alive", "suspected",
// "silent"). Tests may know brain internals: the tripwire pins the rows to belief.peersKnown on a real Encore world, so
// if the meaning of `heard` changes, this test fails instead of the display drifting.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { makeParams } from '../../../src/contracts';
import type { Params, Vec3, World, WorldSnapshot } from '../../../src/contracts';
import { createWorld } from '../../../src/sim';
import { encoreBrain } from '../../../src/agent/encoreBrain';
import { staticBrain } from '../../../src/agent/staticBrain';
import { buildEvalScore } from '../../../src/cli/scenarios';
import { peerSection, type AgentView, type ObserverTruth } from '../../../src/app/ui/Inspector';
import { observerTruth } from '../../../src/app/ui/inspectorTruth';
import * as peerDiffModule from '../../../src/app/ui/peerDiff';
import { peerDiff, referenceTSuspect, type PeerRow, type PeerTruth } from '../../../src/app/ui/peerDiff';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DERIVED = /believed alive|suspected|silent/i;
const TRUTH: PeerTruth = { liveInRange: [3, 1], liveOutOfRange: [7], dead: [2] };

describe('peerDiff.ts isolation', () => {
  const file = 'src/app/ui/peerDiff.ts';
  const source = readFileSync(resolve(root, file), 'utf8');

  it('imports nothing from src/agent, src/sim or src/observer, never mentions WorldSnapshot, and exports no createPanel', () => {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const specifiers: string[] = [];
    const exported: string[] = [];
    const visit = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) specifiers.push('<dynamic>');
      if (ts.isFunctionDeclaration(node) && node.name && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) exported.push(node.name.text);
      ts.forEachChild(node, visit);
    };
    visit(ast);
    for (const spec of specifiers) expect(spec, spec).not.toMatch(/src\/(agent|sim|observer)|\/(agent|sim|observer)(\/|$)|<dynamic>/);
    expect(source).not.toContain('WorldSnapshot');
    expect(exported).toEqual(expect.arrayContaining(['peerDiff', 'referenceTSuspect']));
    // Any export form (function, const, re-export) would make ui/index.ts mount it as a panel.
    expect('createPanel' in peerDiffModule).toBe(false);
  });

  it('compares no age with any parameter: changing the state\'s tSuspect changes only the reference value', () => {
    const state = (tSuspect: number) => ({ params: { tSuspect }, peers: [null, { heard: 90 }, { heard: 10 }, { heard: 99 }, null, null, null, null] });
    expect(peerDiff(state(60), TRUTH, 100)).toEqual(peerDiff(state(1), TRUTH, 100));
    expect(referenceTSuspect(state(60))).toBe(60);
    expect(referenceTSuspect({ params: {} })).toBeNull();
    expect(source).not.toMatch(/heardAgo\s*[<>]=?|[<>]=?\s*heardAgo|tSuspect\s*[<>]/);
  });
});

describe('peerDiff guards', () => {
  it.each<[string, unknown]>([
    ['null state', null],
    ['no peers field', { slot: 1 }],
    ['peers not an array', { peers: { 0: null } }],
    ['an entry without heard', { peers: [null, { slot: 2 }] }],
    ['a non-finite heard', { peers: [null, { heard: NaN }] }],
    ['a string heard', { peers: [null, { heard: '5' }] }],
    ['an array entry', { peers: [[1]] }],
  ])('returns null for %s', (_name, state) => {
    expect(peerDiff(state, TRUTH, 100)).toBeNull();
  });

  it('returns null when now is not finite', () => {
    expect(peerDiff({ peers: [] }, TRUTH, NaN)).toBeNull();
  });
});

describe('peerDiff rows', () => {
  const rows = peerDiff({ peers: [null, { heard: 90 }, { heard: 10, slot: 4 }, null, null, null, null, { heard: 100 }] }, TRUTH, 100) as PeerRow[];

  it('one row per peer the observer knows, sorted by id: the age from drone state (null without an entry) and the truth label', () => {
    expect(rows).toEqual([
      { id: 1, heardAgo: 10, truth: 'alive, in radio range' },
      { id: 2, heardAgo: 90, truth: 'dead' },
      { id: 3, heardAgo: null, truth: 'alive, in radio range' },
      { id: 7, heardAgo: 0, truth: 'alive, out of radio range' },
    ]);
  });

  it('carries only ids, ages and truth labels: no derived label anywhere', () => {
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(['heardAgo', 'id', 'truth']);
    expect(JSON.stringify(rows)).not.toMatch(DERIVED);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Real worlds
// ---------------------------------------------------------------------------------------------------------------

const N = 40;
const P: Params = makeParams(N);

function step(world: World, until: number): WorldSnapshot {
  let snap = world.step();
  while (snap.tick < until) snap = world.step();
  return snap;
}

function viewOf(world: World, snap: WorldSnapshot, id: number): AgentView {
  return { id, inspect: world.inspect(id), belief: snap.drones[id]!.belief };
}

function rowsFor(world: World, snap: WorldSnapshot, id: number): PeerRow[] {
  const truth = observerTruth(snap, null, P, id) as ObserverTruth;
  const inspect = world.inspect(id)!;
  expect(inspect.input.tick).toBe(snap.tick);
  return peerDiff(inspect.state, truth.peers!, inspect.input.tick) as PeerRow[];
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('observerTruth peers (hook 1)', () => {
  it('lists every other drone exactly once: live in range, live out of range, or dead', () => {
    const world = createWorld({ seed: 5, params: P, brain: encoreBrain, score: buildEvalScore(P), events: [{ type: 'KILL', tick: 30, ids: [4, 9] }] });
    const snap = step(world, 60);
    const truth = observerTruth(snap, null, P, 0)!;
    const all = [...truth.peers!.liveInRange, ...truth.peers!.liveOutOfRange, ...truth.peers!.dead].sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: N - 1 }, (_, i) => i + 1));
    expect(truth.peers!.dead).toEqual([4, 9]);
    for (const id of truth.peers!.liveInRange) expect(dist(snap.drones[id]!.pos, snap.drones[0]!.pos)).toBeLessThanOrEqual(P.rRadio);
    for (const id of truth.peers!.liveOutOfRange) expect(dist(snap.drones[id]!.pos, snap.drones[0]!.pos)).toBeGreaterThan(P.rRadio);
    expect(truth.inRadioRange.live).toBe(truth.peers!.liveInRange.length);
  });

  it('lists a dead drone as dead whether it is in radio range or not', () => {
    const world = createWorld({ seed: 5, params: P, brain: encoreBrain, score: buildEvalScore(P) });
    const holding = step(world, 380);
    // The selected drone and its peer at the two ends of the formation: the far one is well beyond rRadio.
    const pos = (id: number) => holding.drones[id]!.pos;
    let sel = 0, far = 1;
    for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) if (dist(pos(a), pos(b)) > dist(pos(sel), pos(far))) { sel = a; far = b; }
    const near = holding.drones.map(d => d.id).filter(id => id !== sel && id !== far).sort((a, b) => dist(pos(a), pos(sel)) - dist(pos(b), pos(sel)))[0]!;
    world.schedule({ type: 'KILL', tick: 381, ids: [near, far] });
    const snap = step(world, 382);
    expect(dist(snap.drones[near]!.pos, snap.drones[sel]!.pos)).toBeLessThanOrEqual(P.rRadio);
    expect(dist(snap.drones[far]!.pos, snap.drones[sel]!.pos)).toBeGreaterThan(P.rRadio);
    expect(observerTruth(snap, null, P, sel)!.peers!.dead).toEqual([near, far].sort((a, b) => a - b));
  });
});

describe('P2-T13 on a real Encore world (n0 40): a stale heartbeat while truth says dead (kill) or alive (jam)', () => {
  const SELECTED = 0;
  const T0 = 400;            // formation A is holding
  const world = createWorld({ seed: 7, params: P, brain: encoreBrain, score: buildEvalScore(P) });
  const before = step(world, T0);
  const rows0 = rowsFor(world, before, SELECTED);
  // Two live peers in range that the selected drone heard within the last heartbeat period or two.
  const fresh = rows0.filter(r => r.truth === 'alive, in radio range' && r.heardAgo !== null && r.heardAgo <= 2 * P.hbPeriod);
  const [killed, jammed] = fresh.map(r => r.id).filter(id => dist(before.drones[id]!.pos, before.drones[SELECTED]!.pos) > 3);
  const jamRadius = 1;
  world.schedule({ type: 'KILL', tick: T0 + 1, ids: [killed!] });
  world.schedule({ type: 'JAM_ON', tick: T0 + 1, id: 'J', centre: [...before.drones[jammed!]!.pos] as Vec3, radius: jamRadius });

  const ages: { tick: number; killed: PeerRow; jammed: PeerRow }[] = [];
  let snap = before;
  for (let t = T0 + 10; t <= T0 + 150; t += 10) {
    snap = step(world, t);
    const rows = rowsFor(world, snap, SELECTED);
    ages.push({ tick: t, killed: rows.find(r => r.id === killed)!, jammed: rows.find(r => r.id === jammed)! });
  }

  it('found a killed and a jammed peer in radio range, with the selected drone outside the jam', () => {
    expect(killed).toBeDefined();
    expect(jammed).toBeDefined();
    expect(dist(before.drones[SELECTED]!.pos, before.drones[jammed!]!.pos)).toBeGreaterThan(jamRadius);
  });

  it('the dead peer\'s age grows tick for tick past tSuspect while truth says dead', () => {
    for (let i = 0; i < ages.length; i++) {
      expect(ages[i]!.killed.truth).toBe('dead');
      if (i > 0) expect(ages[i]!.killed.heardAgo).toBe(ages[i - 1]!.killed.heardAgo! + 10);
    }
    expect(ages[ages.length - 1]!.killed.heardAgo!).toBeGreaterThan(P.tSuspect);
  });

  it('the jammed live peer\'s age grows the same way while truth says alive', () => {
    for (let i = 0; i < ages.length; i++) {
      expect(ages[i]!.jammed.truth).toMatch(/^alive/);
      if (i > 0) expect(ages[i]!.jammed.heardAgo).toBe(ages[i - 1]!.jammed.heardAgo! + 10);
    }
    expect(ages[ages.length - 1]!.jammed.heardAgo!).toBeGreaterThan(P.tSuspect);
    expect(snap.drones[jammed!]!.alive).toBe(true);
  });

  it('the inspector section shows the raw ages and truth labels, the tSuspect reference, and no derived label', () => {
    const section = peerSection(viewOf(world, snap, SELECTED), observerTruth(snap, null, P, SELECTED))!;
    expect(section.reference).toBe(`its tSuspect: ${P.tSuspect} ticks (reference)`);
    expect(section.rows).toHaveLength(N - 1);
    expect(section.rows.find(r => r.id === `#${killed}`)).toEqual({ id: `#${killed}`, heard: `${ages.at(-1)!.killed.heardAgo} ticks ago`, truth: 'dead' });
    for (const row of section.rows) expect(row.heard).toMatch(/^(no entry|\d+ ticks ago)$/);
    expect(JSON.stringify(section)).not.toMatch(DERIVED);
  });
});

describe('tripwire (tests only): rows with heardAgo < tSuspect = belief.peersKnown on a real Encore world', () => {
  it('holds for every drone at launch, in the hold, and after a kill and a jam', () => {
    const world = createWorld({
      seed: 11, params: P, brain: encoreBrain, score: buildEvalScore(P),
      events: [{ type: 'KILL', tick: 300, ids: [5, 6, 7] }, { type: 'JAM_ON', tick: 320, id: 'J', centre: [0, 30, 0], radius: 6 }],
    });
    let checked = 0;
    for (const t of [20, 150, 299, 330, 420]) {
      const snap = step(world, t);
      for (let id = 0; id < N; id++) {
        if (!snap.drones[id]!.alive) continue;
        const known = rowsFor(world, snap, id).filter(r => r.heardAgo !== null && r.heardAgo < P.tSuspect).length;
        expect(known, `drone ${id} at tick ${t}`).toBe(snap.drones[id]!.belief.peersKnown);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(150);
  });
});

describe('the static brain has no peer table: the section is hidden', () => {
  it('peerDiff and peerSection return null for a real static drone', () => {
    const world = createWorld({ seed: 3, params: P, brain: staticBrain, score: buildEvalScore(P) });
    const snap = step(world, 20);
    const truth = observerTruth(snap, null, P, 2)!;
    expect(peerDiff(world.inspect(2)!.state, truth.peers!, snap.tick)).toBeNull();
    expect(peerSection(viewOf(world, snap, 2), truth)).toBeNull();
  });
  it('peerSection is null without a step or without peer truth', () => {
    const world = createWorld({ seed: 3, params: P, brain: encoreBrain, score: buildEvalScore(P) });
    const snap = step(world, 20);
    const truth = observerTruth(snap, null, P, 2)!;
    expect(peerSection({ ...viewOf(world, snap, 2), inspect: null }, truth)).toBeNull();
    expect(peerSection(viewOf(world, snap, 2), { ...truth, peers: undefined })).toBeNull();
    expect(peerSection(viewOf(world, snap, 2), truth)).not.toBeNull();
  });
});
