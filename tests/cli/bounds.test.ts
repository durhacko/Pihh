// P2-WP-08 integration: P2-T12 (tOracle ≤ tFirst95 on every single-kill run, ≤ tRec whenever tRec is defined; swept
// counts ≥ end-of-tick counts on every run). Default suite: one short S2 run at n0 40 (§2.3 item 7). P2_WIDE=1: the
// full S1/S2/S4 runs at n0 40, seeds 1–5, both arms.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { boundsRun, boundsTable, type BoundsRow } from '../../src/cli/bounds';
import { runOne } from '../../src/cli/run';
import { BRAINS } from '../../src/cli/brains';
import { getObserverFactory } from '../../src/cli/observer';

function checkT12(row: BoundsRow): void {
  expect(row.collisionsSwept, `${row.scenario} ${row.arm} s${row.seed}`).toBeGreaterThanOrEqual(row.collisions);
  expect(row.nearMissesSwept, `${row.scenario} ${row.arm} s${row.seed}`).toBeGreaterThanOrEqual(row.nearMisses);
  if (row.tOracle !== null) {
    if (typeof row.tFirst95 === 'number') expect(row.tOracle).toBeLessThanOrEqual(row.tFirst95);
    if (typeof row.tRec === 'number') expect(row.tOracle).toBeLessThanOrEqual(row.tRec);
  }
}

describe('bounds (default suite: one short run)', () => {
  it('S2 at n0 40, 520 ticks, encore: oracle defined at the kill, P2-T12 holds, stateHash is the base run\'s', () => {
    const row = boundsRun({ scenario: 'S2', arm: 'encore', seed: 1, n0: 40, ticks: 520 });
    expect(row.killTick).toBe(400);
    expect(row.tOracle).not.toBeNull();
    checkT12(row);
    // Read-only: the same run through runOne has the same stateHash (the swept counter and oracle change nothing).
    expect(row.stateHash).toBe(runOne({ scenario: 'S2', arm: 'encore', seed: 1, n0: 40, ticks: 520, brains: BRAINS, makeObserver: getObserverFactory() }).stateHash);
    expect(boundsTable([row])).toMatch(/oracle upper bound/);
  }, 60_000);

  it('the CLI refuses an output folder inside results/', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/bounds.ts', '--scenario', 'S2', '--seeds', '1', '--n0', '40', '--out', 'results/phase2/bounds'], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/must not be inside results/);
  }, 60_000);
});

describe.runIf(process.env.P2_WIDE === '1')('bounds (P2_WIDE=1): S1, S2, S4 at n0 40, seeds 1–5, both arms', () => {
  it('P2-T12 on every run', () => {
    const rows: BoundsRow[] = [];
    for (const scenario of ['S1', 'S2', 'S4'] as const) for (const arm of ['static', 'encore'] as const) for (let seed = 1; seed <= 5; seed++) {
      const row = boundsRun({ scenario, arm, seed, n0: 40 });
      expect(row.tOracle).not.toBeNull();
      checkT12(row);
      rows.push(row);
    }
    console.log(boundsTable(rows));
  }, 600_000);
});
