// src/cli/oracle.ts
// P2-WP-08: `tOracle` (PHASE2_EVALUATION §3.2), a labelled ORACLE UPPER BOUND on recovery performance (instant global
// knowledge, no detection delay), so a lower bound on any controller's time to first reach npwc ≥ 0.95 after a kill.
// It is a ceiling, never a competitor arm. Every relaxation (a drone may serve several slots, need not leave its own,
// ignores neighbours and turning) only shortens the time, so on every single-kill run tOracle ≤ tFirst95, and
// tOracle ≤ tRec whenever tRec is defined (P2-T12). Read-only over a snapshot; changes nothing.
import type { EnvEvent, Formation, Params, Score, Vec3, WorldSnapshot } from '../contracts';
import { DT } from '../contracts';
import { measureFormation } from '../observer/measure';
import { currentMovement, expandRecipe } from '../score';

/** reach_d(u): the farthest the world's semi-implicit Euler (velocity first, clamped to vMax, then position by the new
 *  velocity; world.ts step 6) can carry a drone with start speed `speed` in u whole ticks:
 *  Σ_{n=1..u} min(vMax, speed + n·aMax·DT)·DT. Index u of the returned array is reach_d(u). */
export function reachTable(speed: number, ticks: number, params: Params): Float64Array {
  const out = new Float64Array(ticks + 1);
  for (let n = 1; n <= ticks; n++) out[n] = out[n - 1]! + Math.min(params.vMax, speed + n * params.aMax * DT) * DT;
  return out;
}

/** Weight of slot index s in pwc (measure.ts): 2(n0 − s) / (n0(n0 + 1)). */
function weight(index: number, n0: number): number {
  return (2 * (n0 - index)) / (n0 * (n0 + 1));
}

/** P*(M): the pwc of the M most important slots, the most M survivors can reach (measure.ts `capacity`). */
export function bestPwc(alive: number, n0: number): number {
  return (alive * (2 * n0 - alive + 1)) / (n0 * (n0 + 1));
}

export interface OracleResult {
  /** Seconds, or null if the target cannot be reached within the horizon. */
  tOracle: number | null;
  killTick: number;
  alive: number;
  target: number;
  pwcAtKill: number;
}

/**
 * The oracle at kill tick k = snapshotAtKill.tick (the snapshot that already has the kill applied). `score` is the
 * reference score whose formation npwc is measured against; slot positions are taken at k + u, so a movement change
 * inside the horizon is respected. `horizonTicks`: how far to search (the run's remaining ticks).
 */
export function oracleRecoveryBound(snapshotAtKill: WorldSnapshot, score: Score, params: Params, horizonTicks: number): OracleResult {
  const k = snapshotAtKill.tick;
  const n0 = params.n0;
  const formations = new Map<number, Formation>();
  const formationAt = (tick: number): Formation => {
    const { index, movement } = currentMovement(score, tick);
    let f = formations.get(index);
    if (!f) { f = expandRecipe(movement.recipe, n0, params); formations.set(index, f); }
    return f;
  };
  const measured = measureFormation(snapshotAtKill, formationAt(k), params);
  const live = snapshotAtKill.drones.filter(d => d.alive);
  const target = 0.95 * bestPwc(live.length, n0);
  const base: OracleResult = { tOracle: 0, killTick: k, alive: live.length, target, pwcAtKill: measured.pwc };
  if (measured.pwc >= target) return base;
  if (live.length === 0) return { ...base, tOracle: null };

  // Segments of the horizon over which the formation (hence each slot's position) is constant.
  const segments: { from: number; to: number; formation: Formation }[] = [];
  for (let u = 0; u <= horizonTicks; u++) {
    const f = formationAt(k + u);
    const last = segments.at(-1);
    if (last && last.formation === f) last.to = u;
    else segments.push({ from: u, to: u, formation: f });
  }
  const reach = live.map(d => reachTable(Math.hypot(d.vel[0], d.vel[1], d.vel[2]), horizonTicks, params));

  /** Smallest u in [from, to] with table[u] ≥ need (table is non-decreasing), or -1. */
  const firstAtLeast = (table: Float64Array, need: number, from: number, to: number): number => {
    if (table[to]! < need) return -1;
    let lo = from;
    let hi = to;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (table[mid]! >= need) hi = mid; else lo = mid + 1; }
    return lo;
  };

  const candidates: { tau: number; w: number }[] = [];
  measured.status.forEach((status, s) => {
    if (status === 'occupied') return;
    let best = Infinity;
    for (const seg of segments) {
      if (seg.from >= best) break;
      const p = seg.formation.slots[s]!.pos as Vec3;
      for (let i = 0; i < live.length; i++) {
        const upper = best === Infinity ? seg.to : Math.min(seg.to, best - 1);
        if (upper < seg.from) break;
        const x = live[i]!.pos;
        // Boundary note: occupancy (measure.ts) is the squared test d² ≤ rOcc², while `need` uses hypot(d) − rOcc.
        // They can disagree only within rounding of the boundary. A slot that the squared test calls occupied is not a
        // candidate at all; one it calls unoccupied gets `need` ≥ 0 (clamped), which any u ≥ 1 with reach > 0 meets, so
        // the disagreement can only make τ earlier, never later: the bound stays a lower bound on the time.
        const need = Math.max(0, Math.hypot(p[0] - x[0], p[1] - x[1], p[2] - x[2]) - params.rOcc);
        const u = firstAtLeast(reach[i]!, need, seg.from, upper);
        if (u >= 0 && u < best) best = u;
      }
    }
    candidates.push({ tau: best, w: weight(s, n0) });
  });
  candidates.sort((a, b) => a.tau - b.tau || b.w - a.w);
  let pwc = measured.pwc;
  for (const c of candidates) {
    if (c.tau === Infinity) break;
    pwc += c.w;
    if (pwc >= target) return { ...base, tOracle: c.tau * DT };
  }
  return { ...base, tOracle: null };
}

/** Exactly one KILL in the run's events, or null. */
export function singleKillTick(events: readonly EnvEvent[]): number | null {
  const kills = events.filter(e => e.type === 'KILL');
  return kills.length === 1 ? kills[0]!.tick : null;
}

/**
 * tOracle for a run: null unless it has exactly one KILL and `snapshotAtKill` is that tick's snapshot.
 * Also null when the run has any INJECT_SCORE: the oracle measures against one fixed score (`score`), but an injection
 * changes the observer's reference score (and so the formation tFirst95 is measured against) at a time that depends on
 * gossip, which a single-score bound cannot follow. P2-WP-08's runs (S1, S2, S4) have none.
 */
export function tOracleForRun(events: readonly EnvEvent[], snapshotAtKill: WorldSnapshot | null, score: Score, params: Params, horizonTicks: number): OracleResult | null {
  const k = singleKillTick(events);
  if (k === null || !snapshotAtKill || snapshotAtKill.tick !== k) return null;
  if (events.some(e => e.type === 'INJECT_SCORE')) return null;
  return oracleRecoveryBound(snapshotAtKill, score, params, horizonTicks);
}
