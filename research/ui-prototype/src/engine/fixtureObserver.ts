// PROTOTYPE FIXTURE — not src/observer (WP-6).
// Implements the contract's Observer interface with the formulas from docs/validation/evaluation-and-tests.md
// (w_i = 2(n0 − i) / (n0(n0 + 1)), npwc = pwc / P*(M)) so the HUD shows the right *kind* of number.
// sfMean/sfMax are left null here. The UI reads only Observer outputs, never recomputes them.
import type { EnvEvent, Formation, MetricsSample, Observer, Params, Score, SlotStatus, WorldSnapshot } from '@encore/contracts';
import { currentMovement, expandRecipe, newerVersion } from '@encore/score';

export interface FixtureObserver extends Observer {
  /** Recovery time in seconds after the last KILL, or null while not recovered. Mock of the `tRec` summary. */
  recovery(): { since: number | null; seconds: number | null };
}

const vkey = (v: { issuedTick: number; origin: number }) => `${v.issuedTick}:${v.origin}`;

export function createFixtureObserver(params: Params): FixtureObserver {
  const n0 = params.n0;
  const w = Array.from({ length: n0 }, (_, i) => (2 * (n0 - i)) / (n0 * (n0 + 1)));
  const prefix = [0];
  for (let i = 0; i < n0; i++) prefix.push(prefix[i] + w[i]);
  const scores: Score[] = [];
  const events: EnvEvent[] = [];
  const msgs = { hb: 0, score: 0, delivered: 0, lost: 0, blocked: 0 };
  let collisions = 0, nearMisses = 0, slotChanges = 0;
  let lastSlots: number[] | null = null;
  let lastKill: number | null = null;
  let goodSince: number | null = null;
  let recoveredAt: number | null = null;
  let cachedTick = -1;
  let cached: { formation: Formation; inHold: boolean; status: SlotStatus[] } | null = null;

  function reference(snap: WorldSnapshot): Score {
    const believed = new Set(snap.drones.filter(d => d.alive).map(d => vkey(d.belief.version)));
    let best: Score | null = null;
    for (const s of scores) if (believed.has(vkey(s.version)) && (!best || newerVersion(s.version, best.version))) best = s;
    return best ?? scores[0];
  }

  function slotStatus(snap: WorldSnapshot) {
    if (cachedTick === snap.tick && cached) return cached;
    const score = reference(snap);
    const mv = currentMovement(score, snap.tick);
    const formation = expandRecipe(mv.movement.recipe, n0, params);
    const holders = new Array<number>(n0).fill(0);
    const live = snap.drones.filter(d => d.alive);
    for (const d of live) holders[d.belief.slot]++;
    const r2 = params.rOcc ** 2;
    const status: SlotStatus[] = formation.slots.map((slot, i) => {
      if (holders[i] >= 2) return 'contested';
      for (const d of live) {
        const dx = d.pos[0] - slot.pos[0], dy = d.pos[1] - slot.pos[1], dz = d.pos[2] - slot.pos[2];
        if (dx * dx + dy * dy + dz * dz < r2) return 'occupied';
      }
      return holders[i] === 1 ? 'inTransit' : 'vacant';
    });
    cachedTick = snap.tick;
    cached = { formation, inHold: mv.inHold, status };
    return cached;
  }

  return {
    registerScore(score) { scores.push(score); },
    recordEvent(event) { events.push(event); },
    slotStatus,
    sample(snap) {
      for (const r of snap.radio) {
        if (r.type === 'HB') msgs.hb++; else msgs.score++;
        msgs.delivered += r.delivered.length; msgs.lost += r.lost; msgs.blocked += r.jammed + r.partitioned;
      }
      collisions += snap.collisions.length; nearMisses += snap.nearMisses.length;
      const slots = snap.drones.map(d => d.belief.slot);
      if (lastSlots) for (const d of snap.drones) if (d.alive && lastSlots[d.id] !== d.belief.slot) slotChanges++;
      lastSlots = slots;
      for (const e of events) if (e.type === 'KILL' && e.tick === snap.tick) { lastKill = e.tick; goodSince = null; recoveredAt = null; }
      if (snap.tick % 5 !== 0) return null;
      const { status, inHold } = slotStatus(snap);
      const alive = snap.drones.filter(d => d.alive).length;
      let occupied = 0, pwc = 0, dup = 0;
      status.forEach((st, i) => { if (st === 'occupied') { occupied++; pwc += w[i]; } if (st === 'contested') dup++; });
      const versions: Record<string, number> = {};
      for (const d of snap.drones) if (d.alive) versions[vkey(d.belief.version)] = (versions[vkey(d.belief.version)] ?? 0) + 1;
      const npwc = alive > 0 ? Math.min(1, pwc / prefix[alive]) : null;
      if (lastKill !== null && recoveredAt === null && inHold && npwc !== null) {
        if (npwc >= 0.95) { goodSince ??= snap.tick; if (snap.tick - goodSince >= 60) recoveredAt = goodSince; }
        else goodSince = null;
      }
      return {
        tick: snap.tick, alive, coverage: occupied / n0, pwc, npwc, sfMean: null, sfMax: null, dupSlots: dup,
        versions, msgs: { ...msgs }, collisions, nearMisses, slotChanges,
      } satisfies MetricsSample;
    },
    summary() { return { tRec: recoveredAt !== null && lastKill !== null ? (recoveredAt - lastKill) * 0.05 : null }; },
    recovery() {
      return { since: lastKill, seconds: recoveredAt !== null && lastKill !== null ? (recoveredAt - lastKill) * 0.05 : null };
    },
  };
}
