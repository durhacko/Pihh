// tests/g1/g1.test.ts
// Gate G1 (issue #17, WP-1c): the first falsification tests of contract section 8.6, on the REAL world
// (src/sim: packet loss, latency, range-limited radio and sensing), not on an in-test harness.
//   T08  null run             no kills, one formation change, 60 s          -> zero slot changes
//   T09  clumped kill         kill the 5 drones nearest a chosen slot       -> the five conditions of section 8.6
//   T10  silence is not death no kills, a jam over the whole swarm for 35 s -> zero slot changes
// n0 = 40 on a text formation, 20 % packet loss. Seed 1 first, then seeds 1..5 (the task) and 101..105
// (the dev seeds the evaluation doc names for G1). The helpers and every formula are in ./helpers.ts.
//
// What was fixed BEFORE the first run, so that no result could steer it:
//   - the kill centre of a seed is randomIds(seed, all slots, 1)[0], the way scenario S2 draws its centre;
//   - the kill tick is the first tick by which every drone can have canHeal (computed: healReadyTick);
//   - "commit" is a slot change whose belief.heldSince is the tick of the change (a pop restores an older
//     heldSince), so "every commit lowers the slot index" is a real check and not true by definition;
//   - the final npwc is the value at the last tick, 30 s after the kill.
// The seed changes only the radio (which packets are lost, and their latency) and the kill centre: motion
// is deterministic, so a null run flies the same paths on every seed until a brain decides otherwise.
// Runs outside the pass criteria (all 40 kill centres, n0 = 120) are in ./g1.beyond.test.ts.
import { afterAll, describe, expect, it } from 'vitest';
import {
  ALLOWED_OVERRIDES, centreFor, clumpedKill, describeJamRuns, describeKill, describeNullRuns, expectClumpedKillPasses, expectJamRun,
  expectNullRun, expectSetUp, g1Params, jamRun, KILL_HEADER, killRow, LOSS, nullRun, OVERRIDES,
} from './helpers';

const SEEDS = [1, 2, 3, 4, 5];                            // the task's seeds
const DEV_SEEDS = [101, 102, 103, 104, 105];              // evaluation doc section 7: "T08-T10 green on 101-105"

const report: string[] = [];
afterAll(() => { if (report.length) console.log('\n' + report.join('\n') + '\n'); });

describe('G1 on one seed (seed 1), n0 = 40, text formation, 20 % loss, the real world', () => {
  it('uses the contract parameters for n0 = 40 with 20 % loss', () => {
    const p = g1Params(40);
    expect(p.n0).toBe(40);
    expect(p.loss).toBe(0.2);
    expect(p.claimGap).toBe(OVERRIDES.claimGap ?? 2);
    for (const key of Object.keys(OVERRIDES)) expect(ALLOWED_OVERRIDES, `override ${key}`).toContain(key);
    report.push(`G1 parameter overrides on makeParams(n0, { loss: ${LOSS} }): ${JSON.stringify(OVERRIDES)}`);
  });

  it('T08 null run: one formation change, 60 s, no kills: zero slot changes', () => {
    const r = nullRun(1);
    report.push(describeNullRuns('seed 1', [r]));
    expectNullRun(r);
  }, 120000);

  it('T09 clumped kill: 5 drones nearest a slot die in hold; all five conditions within 30 s', () => {
    const r = clumpedKill(1, 40, 5, centreFor(1, 40));
    report.push(...describeKill(r));
    expectSetUp(r);
    expectClumpedKillPasses(r);
  }, 120000);

  it('T10 silence is not death: a 35 s jam over the whole swarm, no kills: zero slot changes', () => {
    const r = jamRun(1);
    report.push(describeJamRuns('seed 1', [r]));
    expectJamRun(r);
  }, 120000);
});

describe.each([['seeds 1 to 5', SEEDS], ['dev seeds 101 to 105', DEV_SEEDS]])('G1 on %s', (label, seeds) => {
  it('T08 null run: zero slot changes on every seed', () => {
    const runs = seeds.map(nullRun);
    report.push(describeNullRuns(label, runs));
    for (const r of runs) expectNullRun(r);
  }, 300000);

  it('T09 clumped kill: all five conditions on every seed', () => {
    const runs = seeds.map(seed => clumpedKill(seed, 40, 5, centreFor(seed, 40)));
    report.push(`G1 clumped kill, ${label} (n0 40, 5 kills, 20 % loss, 30 s after the kill; E = Encore, S = static):`, KILL_HEADER, ...runs.map(killRow));
    for (const r of runs) expectSetUp(r);
    for (const r of runs) expectClumpedKillPasses(r);
  }, 300000);

  it('T10 silence is not death: zero slot changes on every seed', () => {
    const runs = seeds.map(jamRun);
    report.push(describeJamRuns(label, runs));
    for (const r of runs) expectJamRun(r);
  }, 300000);
});
