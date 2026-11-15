// src/observer/invariants.ts
// P2-WP-01: pure, incremental history checkers over the real snapshot stream (Jepsen-style history checking).
// Definitions and thresholds: docs/validation/PHASE2_EVALUATION.md §2 (truth model) and §4 (checked properties).
// Results are "checked properties on these runs, not proofs". Observer-only: this file reads snapshots, recorded
// events and registered scores, keeps its own copies, never mutates its inputs and has no World reference, so it
// cannot affect a brain. Imports only src/contracts, src/score and ./measure (T01).
import type { DroneSnap, EnvEvent, Params, Score, ScoreVersion, Vec3, WorldSnapshot } from '../contracts';
import { currentMovement, expandRecipe, launchPos, newerVersion } from '../score';
import { versionKey } from './measure';

export type InvariantId = 'INV-DUP' | 'INV-MONO' | 'INV-SILENCE' | 'INV-QUIET' | 'INV-CONVERGE' | 'INV-STATIC';
export const INVARIANT_IDS: readonly InvariantId[] = ['INV-DUP', 'INV-MONO', 'INV-SILENCE', 'INV-QUIET', 'INV-CONVERGE', 'INV-STATIC'];

/**
 * Pre-registered thresholds, in ticks: PHASE2_EVALUATION §4 ("Pre-registered by this file"). Code review never
 * chooses or moves them. Ddup is diagnostic only and W belongs to the churn metrics (§3.4); both are listed so
 * the exported set equals the pre-registered one.
 */
export const INVARIANT_DEFAULTS = Object.freeze({ Ddup: 60, Q: 400, C: 600, W: 200 });
export type InvariantThresholds = typeof INVARIANT_DEFAULTS;

/** knownLimit tags, as PHASE2_EVALUATION §4 names them. */
export const KNOWN_LIMIT_3 = '§8.5 limit 3';
export const KNOWN_LIMIT_FLAPPING = 'flapping';

export interface Violation {
  inv: InvariantId;
  tick: number;
  ids: number[];
  slot?: number;
  knownLimit: string | null;   // a documented limit whose shape this matches; null = a counterexample
  detail: string;
}

export interface InvariantReport {
  checked: InvariantId[];
  unavailable: { inv: InvariantId; why: string }[];
  derived: { inv: InvariantId; why: string }[];     // checked, but on a weaker input (§4: "marked derived")
  holding: InvariantId[];                            // checked, zero violations (tagged or not)
  violations: Violation[];
  counterexamples: Violation[];                      // knownLimit === null
  knownLimitInstances: Violation[];                  // knownLimit !== null
  counts: Record<InvariantId, number>;
  silenceExcused: number;                            // slot changes inside the INV-SILENCE window excused on evidence
  lastTick: number;
}

export interface InvariantCheckerOptions {
  params: Params;
  arm: 'encore' | 'static' | 'unknown';
  checks?: InvariantId[];
  thresholds?: Partial<InvariantThresholds>;
  /**
   * The caller registers every environment event of this world with recordEvent (as runOne and runCustom do, also
   * when there are none). Default true. false = events unknown: partitions fall back to partitionSide (pairs are not
   * in contact while two or more partitions are active, which can only suppress a report) and the INV-QUIET anchor
   * is derived from snapshot changes (§2, §4).
   */
  eventsRecorded?: boolean;
}

export interface InvariantChecker {
  registerScore(score: Score): void;
  recordEvent(event: EnvEvent): void;
  ingest(snapshot: WorldSnapshot): Violation[];
  report(): InvariantReport;
  reset(): void;
}

type ArmOption = InvariantCheckerOptions['arm'];

const ENCORE_ONLY: ReadonlySet<InvariantId> = new Set(['INV-SILENCE', 'INV-QUIET', 'INV-CONVERGE']);

function copyVec(v: Vec3): Vec3 { return [v[0], v[1], v[2]]; }
function sameVersion(a: ScoreVersion, b: ScoreVersion): boolean { return a.issuedTick === b.issuedTick && a.origin === b.origin; }

/** Truth radio contact (PHASE2_EVALUATION §2), rebuilt from snapshots and recorded events only. */
export class ContactModel {
  private readonly params: Params;
  private readonly n0: number;
  private readonly eventsRecorded: boolean;
  /** Positions and liveness of snapshot t - 1 (launch positions, all live, before tick 1). */
  prevPos: Vec3[];
  prevAlive: boolean[];
  /** Active partitions in insertion order (a replaced id keeps its place, as the world's Map does). */
  readonly partitions = new Map<string, (0 | 1)[]>();
  loss: number;
  private events = new Map<number, EnvEvent[]>();

  constructor(params: Params, eventsRecorded: boolean) {
    this.params = params;
    this.n0 = params.n0;
    this.eventsRecorded = eventsRecorded;
    this.prevPos = Array.from({ length: this.n0 }, (_, id) => launchPos(id, this.n0));
    this.prevAlive = new Array<boolean>(this.n0).fill(true);
    this.loss = params.loss;
  }

  recordEvent(event: EnvEvent): void {
    const list = this.events.get(event.tick) ?? [];
    list.push(event);
    this.events.set(event.tick, list);
  }

  /** Apply the events of tick t (before reading contact at t). Uses snapshot t - 1 positions, as the world does. */
  beginTick(t: number): void {
    for (const event of this.events.get(t) ?? []) {
      if (event.type === 'PARTITION_ON') {
        const groups = this.prevPos.map((x): 0 | 1 => {
          const d = (x[0] - event.point[0]) * event.normal[0] + (x[1] - event.point[1]) * event.normal[1] + (x[2] - event.point[2]) * event.normal[2];
          return d < 0 ? 0 : 1;
        });
        this.partitions.set(event.id, groups);
      }
      if (event.type === 'PARTITION_OFF') this.partitions.delete(event.id);
      if (event.type === 'SET_LOSS') this.loss = event.loss;
    }
  }

  /** Conditions 1-4 of §2 for a broadcast at tick t between i and j (no random loss): "reachable". */
  reachable(snapshot: WorldSnapshot, i: number, j: number): boolean {
    const a = snapshot.drones[i];
    const b = snapshot.drones[j];
    if (!a?.alive || !b?.alive || i === j) return false;
    if (!this.inRange(i, j)) return false;
    if (this.jammed(snapshot, i) || this.jammed(snapshot, j)) return false;
    return this.sameGroups(snapshot, a, b);
  }

  /** Truth contact: reachable and the current loss below 1. */
  contact(snapshot: WorldSnapshot, i: number, j: number): boolean {
    return this.loss < 1 && this.reachable(snapshot, i, j);
  }

  inRange(i: number, j: number): boolean {
    const p = this.prevPos[i];
    const q = this.prevPos[j];
    const d2 = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
    return d2 <= this.params.rRadio * this.params.rRadio;
  }

  jammed(snapshot: WorldSnapshot, id: number): boolean {
    const x = this.prevPos[id];
    for (const jam of snapshot.jams) {
      if ((x[0] - jam.centre[0]) ** 2 + (x[1] - jam.centre[1]) ** 2 + (x[2] - jam.centre[2]) ** 2 <= jam.radius ** 2) return true;
    }
    return false;
  }

  private sameGroups(snapshot: WorldSnapshot, a: DroneSnap, b: DroneSnap): boolean {
    if (this.eventsRecorded) {
      for (const groups of this.partitions.values()) if (groups[a.id] !== groups[b.id]) return false;
      return true;
    }
    // Fallback without recorded events: partitionSide shows only the oldest partition, so while two or more are
    // active a pair is treated as NOT in contact. This can only suppress a report (§2 item 4).
    if (snapshot.partitions.length >= 2) return false;
    if (snapshot.partitions.length === 1) return a.partitionSide === b.partitionSide;
    return true;
  }

  /** Call after every check of tick t: snapshot t becomes the "previous" snapshot. */
  endTick(snapshot: WorldSnapshot): void {
    for (const d of snapshot.drones) {
      this.prevPos[d.id] = copyVec(d.pos);
      this.prevAlive[d.id] = d.alive;
    }
  }

  /** Union-find components over truth contact among live drones at tick t, on a grid of cell rRadio. */
  components(snapshot: WorldSnapshot): { root: Int32Array; edges: Set<number> } {
    const n0 = this.n0;
    const parent = new Int32Array(n0);
    for (let i = 0; i < n0; i++) parent[i] = i;
    const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const edges = new Set<number>();
    if (this.loss < 1) {
      const cell = this.params.rRadio;
      const buckets = new Map<string, number[]>();
      const live: number[] = [];
      for (const d of snapshot.drones) {
        if (!d.alive) continue;
        live.push(d.id);
        const p = this.prevPos[d.id];
        const key = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)},${Math.floor(p[2] / cell)}`;
        const list = buckets.get(key);
        if (list) list.push(d.id); else buckets.set(key, [d.id]);
      }
      for (const i of live) {
        const p = this.prevPos[i];
        const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          for (const j of buckets.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            if (j <= i || !this.reachable(snapshot, i, j)) continue;
            edges.add(i * n0 + j);
            const ri = find(i), rj = find(j);
            if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
          }
        }
      }
    }
    const root = new Int32Array(n0);
    for (let i = 0; i < n0; i++) root[i] = find(i);
    return { root, edges };
  }
}

/** Create one checker per world. Mirrors Observer: registerScore, recordEvent, then ingest every snapshot. */
export function createInvariantChecker(options: InvariantCheckerOptions): InvariantChecker {
  const params: Params = structuredClone(options.params);
  const arm: ArmOption = options.arm;
  const thresholds: InvariantThresholds = { ...INVARIANT_DEFAULTS, ...(options.thresholds ?? {}) };
  const requested = options.checks ?? [...INVARIANT_IDS];
  const eventsRecorded = options.eventsRecorded ?? true;
  const n0 = params.n0;
  /** At most latencyMax distinct send ticks fall in (c - latencyMax, c], so latencyMax + 1 entries always keep the newest <= c - latencyMax. */
  const HB_KEEP = Math.max(3, params.latencyMax + 1);

  let state = fresh();

  function fresh() {
    const scores = new Map<string, Score>();
    return {
      started: false,
      tick: 0,
      scores,
      preloaded: null as ScoreVersion | null,
      events: [] as EnvEvent[],
      eventTicks: [] as number[],          // sorted ticks of recorded events
      contact: new ContactModel(params, eventsRecorded),
      checked: [] as InvariantId[],
      unavailable: [] as { inv: InvariantId; why: string }[],
      derived: [] as { inv: InvariantId; why: string }[],
      violations: [] as Violation[],
      silenceExcused: 0,
      // per drone, from the previous snapshot
      prevSlot: Int32Array.from({ length: n0 }, (_, i) => i),
      prevHeldSince: new Float64Array(n0),
      prevVersion: new Array<ScoreVersion | null>(n0).fill(null),
      // INV-MONO: observed history stack per drone
      stack: Array.from({ length: n0 }, () => [] as number[]),
      // INV-DUP
      dupPending: new Map<number, { i: number; j: number; slot: number; heldSince: number; sent: number }[]>(),
      dupFlagged: new Set<string>(),
      // INV-SILENCE
      silenceOpen: true,
      silenceEnd: Infinity,
      excusedCommit: new Uint8Array(n0),
      unjudgedCommit: new Uint8Array(n0),
      history: [] as { tick: number; pos: Vec3[]; alive: boolean[] }[],      // snapshots t - L .. t - 1, for vacancy evidence
      // per (receiver, slot): the last HB_KEEP distinct send ticks, enough to keep the newest one <= c - latencyMax
      hbHeard: new Int32Array(n0 * n0 * HB_KEEP).fill(-1),
      // INV-QUIET
      lastVersionChange: new Float64Array(n0),
      lastCommit: new Float64Array(n0).fill(-1),
      derivedEventTick: 0,
      prevEnvKey: '|',
      // INV-CONVERGE
      staleSince: new Float64Array(n0).fill(-1),
      convergeFlagged: new Uint8Array(n0),
      prevComponentKey: new Array<string>(n0).fill(''),
      prevEdges: new Set<number>(),
      lastEdgeChange: new Float64Array(n0).fill(-Infinity),
      // INV-STATIC
      staticFlagged: new Uint8Array(n0),
    };
  }

  function scoreFor(version: ScoreVersion): Score | undefined {
    return state.scores.get(versionKey(version));
  }

  function emit(v: Violation, out: Violation[]): void {
    state.violations.push(v);
    out.push({ ...v, ids: [...v.ids] });   // the caller's copy: editing it cannot change report()
  }

  function noteOnce(list: { inv: InvariantId; why: string }[], inv: InvariantId, why: string): void {
    if (!list.some((u) => u.inv === inv && u.why === why)) list.push({ inv, why });
  }

  function start(first: WorldSnapshot): void {
    state.started = true;
    for (const inv of requested) {
      if (inv === 'INV-STATIC' && arm !== 'static') { state.unavailable.push({ inv, why: `static arm only (arm '${arm}')` }); continue; }
      if (ENCORE_ONLY.has(inv) && arm === 'static') { state.unavailable.push({ inv, why: 'Encore only' }); continue; }
      if ((inv === 'INV-SILENCE' || inv === 'INV-QUIET') && state.scores.size === 0) {
        state.unavailable.push({ inv, why: 'no registered score: slot positions and hold starts are unknown' });
        continue;
      }
      if (!eventsRecorded && inv === 'INV-CONVERGE') {
        // §2 item 4: without recorded events the contact model may only suppress. SET_LOSS is unseen, so a loss-1
        // blackout would still count as contact and could raise a false stall: report unavailable, never derived.
        state.unavailable.push({ inv, why: 'events not recorded: SET_LOSS and partition groups unseen, so truth contact could over-report' });
        continue;
      }
      state.checked.push(inv);
      if (!eventsRecorded && inv === 'INV-QUIET') state.derived.push({ inv, why: 'events not recorded: anchor derived from snapshot changes' });
    }
    // Seeded from the preloaded version, so a version change on tick 1 itself is seen (an uplink lands the same tick).
    for (const d of first.drones) {
      const v = state.preloaded ?? d.belief.version;
      state.prevVersion[d.id] = { issuedTick: v.issuedTick, origin: v.origin };
    }
    if (state.preloaded === null && state.checked.includes('INV-STATIC')) {
      const v = first.drones[0]?.belief.version;
      if (v) state.preloaded = { issuedTick: v.issuedTick, origin: v.origin };
      state.derived.push({ inv: 'INV-STATIC', why: 'no registered score: the preloaded version is taken from the first snapshot' });
    }
    state.eventTicks = state.events.map((e) => e.tick).sort((a, b) => a - b);
  }

  const on = (inv: InvariantId): boolean => state.checked.includes(inv);

  // ---------- INV-DUP (§4): on delivered heartbeats, exact at any loss ----------
  function checkDup(s: WorldSnapshot, out: Violation[]): void {
    // A pending pair is dropped as soon as j leaves (slot, heldSince) on any tick before the check: the brain only
    // compares a heartbeat with the slot it holds when the heartbeat arrives, so j may legally return to it later.
    for (const [at, list] of state.dupPending) {
      if (at === s.tick) continue;
      const kept = list.filter((p) => { const j = s.drones[p.j]; return !!j?.alive && j.belief.slot === p.slot && j.belief.heldSince === p.heldSince; });
      if (kept.length) state.dupPending.set(at, kept); else state.dupPending.delete(at);
    }
    const due = state.dupPending.get(s.tick);
    if (due) {
      state.dupPending.delete(s.tick);
      for (const p of due) {
        const j = s.drones[p.j];
        if (!j?.alive || j.belief.slot !== p.slot || j.belief.heldSince !== p.heldSince) continue;
        const key = `${p.i}:${p.j}:${p.slot}:${p.heldSince}`;
        if (state.dupFlagged.has(key)) continue;
        state.dupFlagged.add(key);
        emit({
          inv: 'INV-DUP', tick: s.tick, ids: [p.i, p.j], slot: p.slot, knownLimit: null,
          detail: `drone ${p.j} still holds slot ${p.slot} (heldSince ${p.heldSince}) ${s.tick - p.sent} ticks after a delivered heartbeat sent at ${p.sent} by earlier holder ${p.i}`,
        }, out);
      }
    }
    const checkAt = s.tick + params.latencyMax + 1;
    for (const e of s.radio) {
      if (e.type !== 'HB') continue;
      const i = s.drones[e.from];
      if (!i?.alive) continue;
      for (const r of e.delivered) {
        const j = s.drones[r];
        if (!j?.alive || j.belief.slot !== i.belief.slot) continue;
        const earlier = i.belief.heldSince < j.belief.heldSince || (i.belief.heldSince === j.belief.heldSince && i.id < j.id);
        if (!earlier) continue;
        const list = state.dupPending.get(checkAt) ?? [];
        list.push({ i: i.id, j: j.id, slot: j.belief.slot, heldSince: j.belief.heldSince, sent: s.tick });
        state.dupPending.set(checkAt, list);
      }
    }
  }

  // ---------- INV-MONO (§4): observed history stack ----------
  function checkMono(d: DroneSnap, from: number, to: number, tick: number, out: Violation[]): void {
    const stack = state.stack[d.id];
    if (to < from) {
      if (from - to < params.claimGap + 1) {
        emit({ inv: 'INV-MONO', tick, ids: [d.id], slot: to, knownLimit: null, detail: `commit ${from} -> ${to} drops by ${from - to} < claimGap + 1 = ${params.claimGap + 1}` }, out);
      }
      stack.push(from);
    } else {
      const at = stack.lastIndexOf(to);
      if (at < 0) {
        emit({ inv: 'INV-MONO', tick, ids: [d.id], slot: to, knownLimit: null, detail: `pop ${from} -> ${to}: ${to} is not on the observed history stack [${stack.join(', ')}]` }, out);
      } else {
        stack.length = at;
      }
    }
  }

  // ---------- INV-SILENCE (§4) ----------
  function slotPos(score: Score, tick: number, v: number): Vec3 | undefined {
    return expandRecipe(currentMovement(score, tick).movement.recipe, n0, params).slots[v]?.pos;
  }

  function snapshotAt(tick: number): { pos: Vec3[]; alive: boolean[] } | undefined {
    if (tick === 0) return { pos: Array.from({ length: n0 }, (_, id) => launchPos(id, n0)), alive: new Array<boolean>(n0).fill(true) };
    return state.history.find((h) => h.tick === tick);
  }

  /** Excuse (a) for a commit by d into v at c, on d's own evidence only. */
  /** missing = an input the excuse needs is absent: the commit cannot be judged (reported unavailable, never a counterexample). */
  function commitExcused(d: DroneSnap, v: number, c: number): { ok: boolean; why: string; missing?: boolean } {
    const score = scoreFor(d.belief.version);
    if (!score) return { ok: false, missing: true, why: `no registered score for version ${versionKey(d.belief.version)}` };
    // Inside the window every live drone flies one version (a second one ends the window), so score_d is the same
    // score on every scan tick below.
    const from = Math.max(1, c - params.tVacant - params.claimWindow);
    for (let s = from; s <= c; s++) {
      if (s % params.hbPeriod !== d.id % params.hbPeriod) continue;
      const before = snapshotAt(s - 1);
      const p = slotPos(score, s, v);
      if (!before || !p) return { ok: false, missing: true, why: `no evidence for scan tick ${s}` };
      for (let k = 0; k < n0; k++) {
        if (k === d.id || !before.alive[k]) continue;
        const x = before.pos[k];
        // Strict, as the brain's occupied() test is: a drone exactly at rOcc does not occupy.
        if (Math.hypot(x[0] - p[0], x[1] - p[1], x[2] - p[2]) < params.rOcc) {
          return { ok: false, why: `scan tick ${s}: drone ${k} was within rOcc of slot ${v}` };
        }
      }
    }
    const lo = c - params.tSuspect - params.latencyMin;   // exclusive
    const hi = c - params.latencyMax;                     // inclusive
    const base = (d.id * n0 + v) * HB_KEEP;
    for (let k = 0; k < HB_KEEP; k++) {
      const sent = state.hbHeard[base + k];
      if (sent > lo && sent <= hi) return { ok: false, why: `a heartbeat from a holder of slot ${v} sent at ${sent} was delivered to it` };
    }
    return { ok: true, why: '' };
  }

  function recordHeard(s: WorldSnapshot): void {
    for (const e of s.radio) {
      if (e.type !== 'HB') continue;
      const slot = s.drones[e.from]?.belief.slot;
      if (slot === undefined) continue;
      for (const r of e.delivered) {
        const base = (r * n0 + slot) * HB_KEEP;
        if (state.hbHeard[base] === s.tick) continue;
        for (let k = HB_KEEP - 1; k > 0; k--) state.hbHeard[base + k] = state.hbHeard[base + k - 1];
        state.hbHeard[base] = s.tick;
      }
    }
  }

  // ---------- INV-QUIET (§4) ----------
  function lastEventAtOrBefore(c: number): number {
    if (!eventsRecorded) return state.derivedEventTick;
    let best = 0;
    for (const t of state.eventTicks) { if (t <= c) best = t; else break; }
    return best;
  }

  // ---------- INV-CONVERGE (§4), on sample ticks ----------
  function checkConverge(s: WorldSnapshot, out: Violation[]): void {
    const { root, edges } = state.contact.components(s);
    // Edge state changes since the previous sample (0.25 s resolution, like the component times).
    for (const e of edges) if (!state.prevEdges.has(e)) { state.lastEdgeChange[Math.floor(e / n0)] = s.tick; state.lastEdgeChange[e % n0] = s.tick; }
    for (const e of state.prevEdges) if (!edges.has(e)) { state.lastEdgeChange[Math.floor(e / n0)] = s.tick; state.lastEdgeChange[e % n0] = s.tick; }
    state.prevEdges = edges;
    const members = new Map<number, number[]>();
    const newest = new Map<number, ScoreVersion>();
    for (const d of s.drones) {
      if (!d.alive) continue;
      const r = root[d.id];
      const list = members.get(r);
      if (list) list.push(d.id); else members.set(r, [d.id]);
      const best = newest.get(r);
      if (!best || newerVersion(d.belief.version, best)) newest.set(r, d.belief.version);
    }
    const keyOf = new Map<number, string>();
    for (const [r, ids] of members) keyOf.set(r, ids.join(','));
    const flapWindow = params.scoreResendMin + params.latencyMax;
    for (const d of s.drones) {
      if (!d.alive) { state.staleSince[d.id] = -1; continue; }
      const r = root[d.id];
      const key = keyOf.get(r) ?? '';
      const changed = key !== state.prevComponentKey[d.id];
      state.prevComponentKey[d.id] = key;
      const best = newest.get(r);
      const stale = best !== undefined && newerVersion(best, d.belief.version);
      if (!stale) { state.staleSince[d.id] = -1; state.convergeFlagged[d.id] = 0; continue; }
      if (state.staleSince[d.id] < 0 || changed) { state.staleSince[d.id] = s.tick; state.convergeFlagged[d.id] = 0; }
      if (s.tick - state.staleSince[d.id] >= thresholds.C && !state.convergeFlagged[d.id]) {
        state.convergeFlagged[d.id] = 1;
        let flapping = false;
        for (const m of members.get(r) ?? []) if (state.lastEdgeChange[m] >= s.tick - flapWindow) { flapping = true; break; }
        emit({
          inv: 'INV-CONVERGE', tick: s.tick, ids: [d.id], knownLimit: flapping ? KNOWN_LIMIT_FLAPPING : null,
          detail: `drone ${d.id} on ${versionKey(d.belief.version)} stale since ${state.staleSince[d.id]} in a stable component of ${members.get(r)?.length ?? 0} holding ${versionKey(best as ScoreVersion)}`,
        }, out);
      }
    }
  }

  function ingest(source: WorldSnapshot): Violation[] {
    if (source.tick < state.tick) throw new Error('Create a new checker (or reset) when resetting the simulation');
    if (source.tick === state.tick) return [];
    if (source.tick !== state.tick + 1) throw new Error('Invariant checker must receive every simulation tick');
    const s = source;
    if (!state.started) start(s);
    state.tick = s.tick;
    state.contact.beginTick(s.tick);
    const out: Violation[] = [];

    if (on('INV-DUP')) checkDup(s, out);
    if (on('INV-SILENCE')) recordHeard(s);

    // Derived anchors and the INV-SILENCE window end, from this snapshot.
    let liveVersions = 0;
    const seen = new Set<string>();
    for (const d of s.drones) {
      if (d.alive) { const k = versionKey(d.belief.version); if (!seen.has(k)) { seen.add(k); liveVersions++; } }
      if (!d.alive && d.diedTick === s.tick) state.derivedEventTick = s.tick;
    }
    if (!eventsRecorded) {
      // Derived anchor: a jam or partition appearing or ending shows in the snapshot lists.
      const envKey = `${s.jams.map((j) => j.id).join(',')}|${s.partitions.map((p) => p.id).join(',')}`;
      if (envKey !== state.prevEnvKey) state.derivedEventTick = s.tick;
      state.prevEnvKey = envKey;
    }
    if (state.silenceOpen) {
      const kill = state.events.some((e) => e.type === 'KILL' && e.tick <= s.tick) || s.drones.some((d) => !d.alive);
      if (kill || liveVersions >= 2) { state.silenceOpen = false; state.silenceEnd = s.tick; }
    }

    // Version changes first, in their own pass, so this tick's derived anchor is final before any commit is checked
    // (otherwise the result would depend on drone id order).
    for (const d of s.drones) {
      const prevVersion = state.prevVersion[d.id];
      if (prevVersion && !sameVersion(prevVersion, d.belief.version)) {
        state.lastVersionChange[d.id] = s.tick;
        if (!eventsRecorded) state.derivedEventTick = Math.max(state.derivedEventTick, s.tick);
      }
      state.prevVersion[d.id] = { issuedTick: d.belief.version.issuedTick, origin: d.belief.version.origin };
    }

    for (const d of s.drones) {
      if (!d.alive) continue;
      const from = state.prevSlot[d.id];
      const to = d.belief.slot;

      if (on('INV-STATIC') && !state.staticFlagged[d.id]) {
        const pre = state.preloaded;
        if (to !== d.id || (pre && !sameVersion(pre, d.belief.version))) {
          state.staticFlagged[d.id] = 1;
          emit({ inv: 'INV-STATIC', tick: s.tick, ids: [d.id], slot: to, knownLimit: null, detail: `static drone ${d.id} on slot ${to}, version ${versionKey(d.belief.version)}` }, out);
        }
      }

      if (to !== from) {
        if (on('INV-MONO')) checkMono(d, from, to, s.tick, out);
        const commit = to < from;
        if (on('INV-SILENCE') && s.tick < state.silenceEnd) {
          if (commit) {
            const excuse = commitExcused(d, to, s.tick);
            if (excuse.ok) { state.excusedCommit[d.id] = 1; state.silenceExcused++; }
            else if (excuse.missing) {
              // Not judged: the evidence the excuse needs is absent. Its later pop is not judged either.
              state.unjudgedCommit[d.id] = 1;
              noteOnce(state.unavailable, 'INV-SILENCE', `some changes not judged: ${excuse.why}`);
            }
            else emit({ inv: 'INV-SILENCE', tick: s.tick, ids: [d.id], slot: to, knownLimit: null, detail: `commit ${from} -> ${to} before the first kill or version split, unexcused: ${excuse.why}` }, out);
          } else if (state.excusedCommit[d.id]) {
            state.silenceExcused++;
          } else if (state.unjudgedCommit[d.id]) {
            noteOnce(state.unavailable, 'INV-SILENCE', 'some pops not judged: they follow a commit that could not be judged');
          } else {
            emit({ inv: 'INV-SILENCE', tick: s.tick, ids: [d.id], slot: to, knownLimit: null, detail: `pop ${from} -> ${to} before the first kill or version split, with no excused commit` }, out);
          }
        }
        const quietScore = on('INV-QUIET') && commit ? scoreFor(d.belief.version) : undefined;
        if (on('INV-QUIET') && commit && !quietScore) {
          // score_d unknown: its holdStart cannot be read, so this commit is not judged (never a guessed anchor).
          noteOnce(state.unavailable, 'INV-QUIET', `commits on unregistered version ${versionKey(d.belief.version)} not checked`);
        }
        if (quietScore) {
          const hold = currentMovement(quietScore, s.tick).holdStart;
          const anchor = Math.max(lastEventAtOrBefore(s.tick), hold, state.lastVersionChange[d.id]);
          if (s.tick - anchor > thresholds.Q) {
            const tagged = state.lastCommit[d.id] > anchor;
            emit({
              inv: 'INV-QUIET', tick: s.tick, ids: [d.id], slot: to, knownLimit: tagged ? KNOWN_LIMIT_3 : null,
              detail: `commit ${from} -> ${to} ${s.tick - anchor} ticks after its anchor ${anchor} (Q = ${thresholds.Q})${tagged ? `; second commit since the anchor (first at ${state.lastCommit[d.id]})` : ''}`,
            }, out);
          }
        }
        if (commit) state.lastCommit[d.id] = s.tick;
      }
      state.prevSlot[d.id] = to;
      state.prevHeldSince[d.id] = d.belief.heldSince;
    }

    if (on('INV-CONVERGE') && s.tick % 5 === 0) checkConverge(s, out);

    // Keep the last tVacant + claimWindow + 1 snapshots' positions for INV-SILENCE's scan-tick evidence.
    if (on('INV-SILENCE') && s.tick < state.silenceEnd) {
      state.history.push({ tick: s.tick, pos: s.drones.map((d) => copyVec(d.pos)), alive: s.drones.map((d) => d.alive) });
      const keep = params.tVacant + params.claimWindow + 2;
      if (state.history.length > keep) state.history.splice(0, state.history.length - keep);
    } else if (state.history.length) {
      state.history = [];
    }
    state.contact.endTick(s);
    return out;
  }

  function report(): InvariantReport {
    const counts = Object.fromEntries(INVARIANT_IDS.map((id) => [id, 0])) as Record<InvariantId, number>;
    for (const v of state.violations) counts[v.inv]++;
    const violations = state.violations.map((v) => ({ ...v, ids: [...v.ids] }));
    return {
      checked: [...state.checked],
      unavailable: state.unavailable.map((u) => ({ ...u })),
      derived: state.derived.map((u) => ({ ...u })),
      holding: state.checked.filter((id) => counts[id] === 0),
      violations,
      counterexamples: violations.filter((v) => v.knownLimit === null),
      knownLimitInstances: violations.filter((v) => v.knownLimit !== null),
      counts,
      silenceExcused: state.silenceExcused,
      lastTick: state.tick,
    };
  }

  return {
    registerScore(score) {
      const copy = structuredClone(score);
      state.scores.set(versionKey(copy.version), copy);
      state.preloaded ??= { ...copy.version };
    },
    recordEvent(event) {
      if (!Number.isInteger(event.tick) || event.tick < 1) throw new Error('Invalid event tick');
      const copy = structuredClone(event);
      state.events.push(copy);
      state.contact.recordEvent(copy);
      if (state.started) state.eventTicks = state.events.map((e) => e.tick).sort((a, b) => a - b);
    },
    ingest,
    report,
    reset() {
      const scores = state.scores, events = state.events, preloaded = state.preloaded;
      state = fresh();
      for (const [k, v] of scores) state.scores.set(k, v);
      state.preloaded = preloaded;
      for (const e of events) { state.events.push(e); state.contact.recordEvent(e); }
    },
  };
}
