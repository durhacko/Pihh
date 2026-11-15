// tests/g4/dissemination.test.ts
// Gate G4 (issue #21, contract section 9) on the real world with the real Encore brain flying its real formation:
// a connected swarm adopts everywhere; a jam stops adoption inside the jam until JAM_OFF; a group partition stops it
// in the other group until PARTITION_OFF. T16 (scores injected on both sides of a partition) is in
// versionOrder.test.ts. Every run also checks the rate limit
// (at most one SCORE per drone per scoreResendMin) and reports adoption times and slot churn (section 8.5, limit 7).
import { describe, expect, it } from 'vitest';
import { makeParams } from '../../src/contracts';
import type { EnvEvent, Score, Vec3, WorldSnapshot } from '../../src/contracts';
import { composeNext, makeScore } from '../../src/score';
import { encoreBrain } from '../../src/agent/encoreBrain';
import { checkRateLimit, dist, minSendGap, run, sameVersion, secs } from './harness';

const N = 40;
const INJECT = 300;                       // the preloaded sphere is in hold well before this
const PRE_RECIPE = { kind: 'sphere' } as const;
const NEW_RECIPE = { kind: 'text', text: 'HI' } as const;
const SPLIT = { point: [0, 30, 0] as Vec3, normal: [1, 0, 0] as Vec3 };   // through the formation centre
const RECOVERY = 400;                    // ticks after radio returns by which every drone must have adopted

function preloaded(n0: number, loss = 0.05) {
  const params = makeParams(n0, { loss });
  return { params, pre: makeScore([PRE_RECIPE], n0, params) };
}

const maxDelay = (adopted: (number | null)[], from: number, ids?: number[]): number =>
  Math.max(...(ids ?? adopted.map((_, i) => i)).map((i) => (adopted[i] === null ? Infinity : (adopted[i] as number) - from)));

/** Side of plane SPLIT for a position: 0 below (dot < 0), 1 otherwise, as the world assigns partition groups. */
const side = (p: Vec3): 0 | 1 => ((p[0] - SPLIT.point[0]) * SPLIT.normal[0] + (p[1] - SPLIT.point[1]) * SPLIT.normal[1] + (p[2] - SPLIT.point[2]) * SPLIT.normal[2] < 0 ? 0 : 1);

describe('G4: a connected swarm adopts an injected score everywhere', () => {
  it.each([0.05, 0.2])('n0 = 40, loss %f: every drone adopts; at most one SCORE per drone per scoreResendMin', (loss) => {
    const { params, pre } = preloaded(N, loss);
    const next = composeNext(pre, INJECT, NEW_RECIPE, 7, N, params);
    const r = run({
      seed: 1, params, score: pre, brain: encoreBrain, ticks: INJECT + 400,
      events: [{ type: 'INJECT_SCORE', tick: INJECT, droneId: 7, score: next }], watch: next.version,
    });
    expect(r.adopted.every((t) => t !== null)).toBe(true);
    checkRateLimit([minSendGap(r.sends)], params.scoreResendMin);
    console.log(`G4 swarm n0=40 loss ${loss}: 100% adopted, last after ${maxDelay(r.adopted, INJECT)} ticks (${secs(maxDelay(r.adopted, INJECT))} s); ${r.sends.length} SCORE sends`);
  }, 30_000);

  it('n0 = 200 (multi-hop: the text formation is wider than rRadio), loss 0.2: every drone adopts', () => {
    const params = makeParams(200, { loss: 0.2 });
    const pre = makeScore([{ kind: 'text', text: 'ENCORE' }], 200, params);
    const next = composeNext(pre, 400, { kind: 'sphere' }, 0, 200, params);
    const r = run({
      seed: 1, params, score: pre, brain: encoreBrain, ticks: 400 + 400,
      events: [{ type: 'INJECT_SCORE', tick: 400, droneId: 0, score: next }], watch: next.version,
    });
    expect(r.adopted.every((t) => t !== null)).toBe(true);
    checkRateLimit([minSendGap(r.sends)], params.scoreResendMin);
    console.log(`G4 swarm n0=200 loss 0.2: 100% adopted, last after ${maxDelay(r.adopted, 400)} ticks (${secs(maxDelay(r.adopted, 400))} s); ${r.sends.length} SCORE sends`);
  }, 60_000); // Heavy world stepping: headroom for CPU contention under parallel load (30 s was seen to time out).
});

describe('G4: a jam stops adoption inside it until JAM_OFF, then all adopt', () => {
  it('n0 = 40: zero adopters among the drones inside the jam until JAM_OFF; all 40 within 400 ticks after', () => {
    const { params, pre } = preloaded(N);
    const JAM_ON = 250, JAM_OFF = 700;
    let inside: Set<number> | null = null;
    let target = -1;
    let centre: Vec3 = [0, 0, 0];
    let radius = 0;
    let next: Score | null = null;
    const neverLeft = new Set<number>();
    const snaps: WorldSnapshot[] = [];
    // Pick the jam from where the drones really are just before JAM_ON: centred on the drone with the largest x,
    // radius to its 10th nearest neighbour, so about a quarter of the swarm is inside. Inject at the farthest drone.
    const onTick = (snap: WorldSnapshot, schedule: (e: EnvEvent) => void) => {
      snaps.push(snap);
      if (snap.tick === JAM_ON - 1) {
        const pos = snap.drones.map((d) => d.pos);
        const c = pos.reduce((best, p, i) => (p[0] > pos[best][0] ? i : best), 0);
        centre = [...pos[c]] as Vec3;
        radius = pos.map((p) => dist(p, centre)).sort((a, b) => a - b)[10] + 0.05;
        target = pos.reduce((best, p, i) => (dist(p, centre) > dist(pos[best], centre) ? i : best), 0);
        next = composeNext(pre, INJECT, NEW_RECIPE, target, N, params);
        schedule({ type: 'JAM_ON', tick: JAM_ON, id: 'J', centre, radius });
        schedule({ type: 'JAM_OFF', tick: JAM_OFF, id: 'J' });
        schedule({ type: 'INJECT_SCORE', tick: INJECT, droneId: target, score: next });
      }
      if (snap.tick === JAM_ON) {
        inside = new Set(snap.drones.filter((d) => dist(d.pos, centre) <= radius).map((d) => d.id));
        for (const id of inside) neverLeft.add(id);
      }
      if (inside !== null && snap.tick > JAM_ON && snap.tick < JAM_OFF) {
        for (const d of snap.drones) if (dist(d.pos, centre) > radius) neverLeft.delete(d.id);
      }
    };
    // The watched version is only known once the jam is placed, so time adoption after the run.
    const r = run({ seed: 2, params, score: pre, brain: encoreBrain, ticks: JAM_OFF + RECOVERY, onTick, watch: { issuedTick: INJECT, origin: -2 } });
    expect(next).not.toBeNull();
    const version = (next as unknown as Score).version;
    const adoptedAt = Array.from({ length: N }, (_, id) => snaps.find((s) => sameVersion(s.drones[id].belief.version, version))?.tick ?? null);
    expect(inside).not.toBeNull();
    expect(neverLeft.size).toBeGreaterThanOrEqual(8);
    expect(neverLeft.has(target)).toBe(false);
    // Inside the jam for the whole jam: nobody adopts before JAM_OFF.
    for (const id of neverLeft) expect(adoptedAt[id] === null || (adoptedAt[id] as number) >= JAM_OFF, `drone ${id} adopted at ${adoptedAt[id]}`).toBe(true);
    // Outside: adoption goes on during the jam.
    const outside = Array.from({ length: N }, (_, i) => i).filter((i) => !(inside as Set<number>).has(i));
    expect(outside.some((i) => adoptedAt[i] !== null && (adoptedAt[i] as number) < JAM_OFF)).toBe(true);
    // After JAM_OFF: all.
    expect(adoptedAt.every((t) => t !== null)).toBe(true);
    checkRateLimit([minSendGap(r.sends)], params.scoreResendMin);
    console.log(`G4 jam n0=40: ${neverLeft.size} drones inside the jam throughout, 0 adopted before JAM_OFF; ` +
      `last inside drone adopted ${maxDelay(adoptedAt, JAM_OFF, [...neverLeft])} ticks after JAM_OFF; all 40 by ${maxDelay(adoptedAt, JAM_OFF)} ticks after JAM_OFF`);
  }, 30_000);
});

describe('G4: a group partition stops adoption in the other group until PARTITION_OFF, then all adopt', () => {
  it('n0 = 40: zero adopters in group 1 until PARTITION_OFF; group 0 adopts during the split; all within 400 ticks after', () => {
    const { params, pre } = preloaded(N);
    const ON = 250, OFF = 800;
    let groups: (0 | 1)[] = [];
    let next: Score | null = null;
    const onTick = (snap: WorldSnapshot, schedule: (e: EnvEvent) => void) => {
      if (snap.tick === ON - 1) {
        groups = snap.drones.map((d) => side(d.pos));
        const inject = groups.indexOf(0);
        next = composeNext(pre, INJECT, NEW_RECIPE, inject, N, params);
        schedule({ type: 'PARTITION_ON', tick: ON, id: 'P', point: [...SPLIT.point], normal: [...SPLIT.normal] });
        schedule({ type: 'PARTITION_OFF', tick: OFF, id: 'P' });
        schedule({ type: 'INJECT_SCORE', tick: INJECT, droneId: inject, score: next });
      }
      if (snap.tick === ON) for (const d of snap.drones) expect(d.partitionSide).toBe(groups[d.id]);
    };
    const snaps: WorldSnapshot[] = [];
    const r = run({ seed: 3, params, score: pre, brain: encoreBrain, ticks: OFF + RECOVERY, watch: { issuedTick: INJECT, origin: -2 }, onTick: (s, sch) => { snaps.push(s); onTick(s, sch); } });
    const version = (next as unknown as Score).version;
    const adoptedAt = Array.from({ length: N }, (_, id) => snaps.find((s) => sameVersion(s.drones[id].belief.version, version))?.tick ?? null);
    const g0 = groups.flatMap((g, i) => (g === 0 ? [i] : []));
    const g1 = groups.flatMap((g, i) => (g === 1 ? [i] : []));
    expect(g0.length).toBeGreaterThanOrEqual(10);
    expect(g1.length).toBeGreaterThanOrEqual(10);
    for (const id of g1) expect(adoptedAt[id] === null || (adoptedAt[id] as number) >= OFF, `group-1 drone ${id} adopted at ${adoptedAt[id]}`).toBe(true);
    for (const id of g0) expect(adoptedAt[id] !== null && (adoptedAt[id] as number) < OFF, `group-0 drone ${id}`).toBe(true);
    expect(adoptedAt.every((t) => t !== null)).toBe(true);
    checkRateLimit([minSendGap(r.sends)], params.scoreResendMin);
    const churn = r.slotChanges.reduce((a, b) => a + b, 0);
    console.log(`G4 partition n0=40: group 0 (${g0.length}) all adopted by ${maxDelay(adoptedAt, INJECT, g0)} ticks after injection; ` +
      `group 1 (${g1.length}) 0 before PARTITION_OFF, all by ${maxDelay(adoptedAt, OFF, g1)} ticks after; ` +
      `limit-7 churn: ${churn} slot changes, ${r.dupTicks} duplicate-slot ticks`);
  }, 30_000);
});
