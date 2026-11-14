// UI ACTION ADAPTER (prototype).
// The only module that creates worlds, steps them and schedules events: experience doc §1 places this in
// src/app/{main,worlds,actions}.ts. UI code emits Intents; this resolves each one ONCE into an explicit
// EnvEvent at tick + 1 and schedules the same object into both worlds (FR-24). It never touches brain state.
import { DT, makeParams, OPERATOR } from '@encore/contracts';
import type { EnvEvent, MetricsSample, Params, RadioEvent, Recipe, Score, Vec3, World, WorldSnapshot } from '@encore/contracts';
import { composeNext, currentMovement, makeScore } from '@encore/score';
import { staticBrain } from '@encore/agent/staticBrain';
import { createFixtureWorld } from './fixtureWorld';
import { fixtureEncoreBrain } from './fixtureEncoreBrain';
import { createFixtureObserver, type FixtureObserver } from './fixtureObserver';

export type Arm = 'encore' | 'static';
export type Support = 'main' | 'prototype';

/** What the code on main supports today (src/sim/world.ts WP-2a accepts KILL, JAM_ON, JAM_OFF only). */
export const EVENT_SUPPORT: Record<EnvEvent['type'], Support> = {
  KILL: 'main', JAM_ON: 'main', JAM_OFF: 'main',
  PARTITION_ON: 'prototype', PARTITION_OFF: 'prototype', INJECT_SCORE: 'prototype', SET_LOSS: 'prototype',
};

export type Intent =
  | { kind: 'kill'; ids: number[] }
  | { kind: 'killRegion'; centre: Vec3; radius: number }
  | { kind: 'killRandom'; fraction: number }
  | { kind: 'jamOn'; centre: Vec3; radius: number }
  | { kind: 'jamOff'; id?: string }
  | { kind: 'partitionOn'; point: Vec3; normal: Vec3 }
  | { kind: 'partitionOff' }
  | { kind: 'setLoss'; loss: number }
  | { kind: 'inject'; droneId: number; recipe: Recipe; name: string };

export type DispatchResult =
  | { ok: true; event: EnvEvent; summary: string; support: Support }
  | { ok: false; error: string };

export interface LogEntry { seq: number; tick: number; kind: 'accepted' | 'applied' | 'observed' | 'error' | 'info'; text: string; support?: Support }

export interface ArmState {
  arm: Arm; world: World; observer: FixtureObserver;
  prev: WorldSnapshot; curr: WorldSnapshot;
  sample: MetricsSample | null; series: MetricsSample[];
  /** The last second of real RadioEvent logs, kept so the renderer never misses a tick stepped between frames. */
  radioHistory: { tick: number; radio: RadioEvent[] }[];
}

export interface Injection { key: string; name: string; droneId: number; tick: number; score: Score; recipe: Recipe; milestones: Set<number> }

export interface Cue { index: number; name: string; recipe: Recipe; startTick: number; transitionTicks: number; source: 'preloaded' | 'injected'; versionKey: string }

const vkey = (v: { issuedTick: number; origin: number }) => `${v.issuedTick}:${v.origin}`;

export function idsInSphere(snap: WorldSnapshot, centre: Vec3, radius: number): number[] {
  const r2 = radius * radius;
  return snap.drones.filter(d => d.alive && (d.pos[0] - centre[0]) ** 2 + (d.pos[1] - centre[1]) ** 2 + (d.pos[2] - centre[2]) ** 2 <= r2).map(d => d.id);
}

export function recipeLabel(r: Recipe): string {
  return r.kind === 'text' ? `“${r.text}”` : r.kind === 'sphere' ? 'Sphere' : 'Double helix';
}

export class Session {
  readonly params: Params;
  seed: number;
  arms!: Record<Arm, ArmState>;
  preloaded!: Score;
  injections: Injection[] = [];
  scheduled: EnvEvent[] = [];
  logEntries: LogEntry[] = [];
  playing = true;
  speed = 1;
  private acc = 0;
  private seq = 0;
  private jamSeq = 0;
  private listeners = new Set<(e: LogEntry) => void>();
  private resetListeners = new Set<() => void>();
  stepMs = 0;

  constructor(seed = 42, n0 = 200) {
    this.params = makeParams(n0);
    this.seed = seed;
    this.reset(seed);
  }

  get tick(): number { return this.arms.encore.curr.tick; }
  get loss(): number {
    const last = this.scheduled.filter(e => e.type === 'SET_LOSS' && e.tick <= this.tick).pop();
    return last?.type === 'SET_LOSS' ? last.loss : this.params.loss;
  }

  onLog(fn: (e: LogEntry) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onReset(fn: () => void): () => void { this.resetListeners.add(fn); return () => this.resetListeners.delete(fn); }

  log(kind: LogEntry['kind'], text: string, support?: Support): LogEntry {
    const entry: LogEntry = { seq: ++this.seq, tick: this.arms?.encore.curr.tick ?? 0, kind, text, support };
    this.logEntries.push(entry);
    if (this.logEntries.length > 400) this.logEntries.shift();
    for (const fn of this.listeners) fn(entry);
    return entry;
  }

  reset(seed = this.seed): void {
    this.seed = seed;
    const p = this.params;
    this.preloaded = makeScore([
      { kind: 'text', text: 'ENCORE' },
      { kind: 'helix' },
    ], p.n0, p);
    const build = (arm: Arm): ArmState => {
      const world = createFixtureWorld({ seed, params: p, brain: arm === 'encore' ? fixtureEncoreBrain as never : staticBrain as never, score: this.preloaded });
      const observer = createFixtureObserver(p);
      observer.registerScore(this.preloaded);
      const first = world.step();
      observer.sample(first);
      return { arm, world, observer, prev: first, curr: first, sample: null, series: [], radioHistory: [] };
    };
    this.arms = { encore: build('encore'), static: build('static') };
    this.injections = [];
    this.scheduled = [];
    this.acc = 0;
    this.jamSeq = 0;
    for (const fn of this.resetListeners) fn();
    this.log('info', `Reset · seed ${seed} · ${p.n0} drones · preloaded score 0:${OPERATOR}`);
  }

  advance(dtReal: number): number {
    if (!this.playing) return 0;
    this.acc += Math.min(dtReal, 0.1) * this.speed;
    let steps = 0;
    const maxSteps = Math.max(5, Math.ceil(this.speed * 3));
    const t0 = performance.now();
    while (this.acc >= DT && steps < maxSteps) { this.stepOnce(); this.acc -= DT; steps++; }
    if (steps === maxSteps) this.acc = 0;
    if (steps) this.stepMs = (performance.now() - t0) / steps;
    return steps;
  }
  get alpha(): number { return Math.max(0, Math.min(1, this.acc / DT)); }

  stepOnce(): void {
    for (const a of [this.arms.encore, this.arms.static]) {
      const snap = a.world.step();
      a.prev = a.curr; a.curr = snap;
      a.radioHistory.push({ tick: snap.tick, radio: snap.radio });
      if (a.radioHistory.length > 20) a.radioHistory.shift();
      const s = a.observer.sample(snap);
      if (s) { a.sample = s; a.series.push(s); if (a.series.length > 2400) a.series.shift(); }
    }
    const t = this.tick;
    for (const e of this.scheduled) if (e.tick === t) this.log('applied', describeEvent(e, 'applied'), EVENT_SUPPORT[e.type]);
    this.watchAdoption();
  }

  private watchAdoption(): void {
    const s = this.arms.encore.sample;
    if (!s || s.tick !== this.tick) return;
    for (const inj of this.injections) {
      const n = s.versions[inj.key] ?? 0;
      const share = s.alive ? n / s.alive : 0;
      for (const m of [0.25, 0.5, 0.9, 1]) {
        if (share >= m && !inj.milestones.has(m)) {
          inj.milestones.add(m);
          this.log('observed', `${inj.name} (v${inj.key}) believed by ${n}/${s.alive} live Encore drones${m === 1 ? ' — fully adopted' : ''}`);
        }
      }
    }
  }

  liveIds(arm: Arm = 'encore'): number[] { return this.arms[arm].curr.drones.filter(d => d.alive).map(d => d.id); }

  /** The operator's plan: the preloaded movements plus every injected composition. Not what drones hold. */
  cues(): Cue[] {
    const cues: Cue[] = this.preloaded.movements.map((m, i) => ({ index: i, name: recipeLabel(m.recipe), recipe: m.recipe, startTick: m.startTick, transitionTicks: m.transitionTicks, source: 'preloaded' as const, versionKey: vkey(this.preloaded.version) }));
    for (const inj of this.injections) {
      // An injected score replaces every movement that had not started by its issue tick (composeNext).
      for (let i = cues.length - 1; i >= 0; i--) if (cues[i].startTick > inj.tick) cues.splice(i, 1);
      const m = inj.score.movements[inj.score.movements.length - 1];
      // A later movement in the plan ends earlier movements' holds; the plan reads as a sequence.
      cues.push({ index: cues.length, name: inj.name, recipe: m.recipe, startTick: m.startTick, transitionTicks: m.transitionTicks, source: 'injected', versionKey: inj.key });
    }
    return cues.sort((a, b) => a.startTick - b.startTick);
  }

  /** The newest score the operator has issued (base for composeNext). */
  planScore(): Score {
    return this.injections.length ? this.injections[this.injections.length - 1].score : this.preloaded;
  }

  dispatch(intent: Intent): DispatchResult {
    const tick = this.tick + 1;
    const snap = this.arms.encore.curr;
    let event: EnvEvent;
    try {
      switch (intent.kind) {
        case 'kill': {
          const ids = intent.ids.filter(id => snap.drones[id]?.alive);
          if (!ids.length) return this.fail('No live drone matches. Dead drones cannot be killed again.');
          event = { type: 'KILL', tick, ids };
          break;
        }
        case 'killRegion': {
          if (!(intent.radius > 0 && intent.radius <= 40)) return this.fail('Radius must be between 0 and 40 m.');
          const ids = idsInSphere(snap, intent.centre, intent.radius);
          if (!ids.length) return this.fail(`No live drone within ${intent.radius} m of that point.`);
          event = { type: 'KILL', tick, ids };
          break;
        }
        case 'killRandom': {
          const live = this.liveIds();
          const n = Math.max(1, Math.round(live.length * intent.fraction));
          let r = (this.seed * 2654435761 + tick) >>> 0;
          const pool = [...live];
          const ids: number[] = [];
          while (ids.length < n && pool.length) { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; ids.push(pool.splice(r % pool.length, 1)[0]); }
          event = { type: 'KILL', tick, ids: ids.sort((a, b) => a - b) };
          break;
        }
        case 'jamOn': {
          if (!(intent.radius > 0 && intent.radius <= 60)) return this.fail('Jam radius must be between 0 and 60 m.');
          event = { type: 'JAM_ON', tick, id: `jam-${++this.jamSeq}`, centre: intent.centre, radius: intent.radius };
          break;
        }
        case 'jamOff': {
          const jams = snap.jams;
          if (!jams.length) return this.fail('No jam is active.');
          const id = intent.id ?? jams[jams.length - 1].id;
          if (!jams.some(j => j.id === id)) return this.fail(`No active jam called ${id}.`);
          event = { type: 'JAM_OFF', tick, id };
          break;
        }
        case 'partitionOn': {
          if (snap.partitions.length) return this.fail('A partition is already active. Reconnect first.');
          event = { type: 'PARTITION_ON', tick, id: 'split-1', point: intent.point, normal: intent.normal };
          break;
        }
        case 'partitionOff': {
          if (!snap.partitions.length) return this.fail('No partition is active.');
          event = { type: 'PARTITION_OFF', tick, id: snap.partitions[0].id };
          break;
        }
        case 'setLoss': {
          if (!(intent.loss >= 0 && intent.loss <= 0.9)) return this.fail('Packet loss must be between 0% and 90%.');
          event = { type: 'SET_LOSS', tick, loss: intent.loss };
          break;
        }
        case 'inject': {
          const d = snap.drones[intent.droneId];
          if (!d) return this.fail(`There is no drone ${intent.droneId}. Ids run 0–${this.params.n0 - 1}.`);
          if (!d.alive) return this.fail(`Drone ${intent.droneId} is dead and cannot receive the uplink.`);
          const score = composeNext(this.planScore(), tick, intent.recipe, intent.droneId, this.params.n0, this.params);
          event = { type: 'INJECT_SCORE', tick, droneId: intent.droneId, score };
          const key = vkey(score.version);
          this.injections.push({ key, name: intent.name, droneId: intent.droneId, tick, score, recipe: intent.recipe, milestones: new Set() });
          for (const a of Object.values(this.arms)) a.observer.registerScore(score);
          break;
        }
      }
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : String(error));
    }
    for (const a of Object.values(this.arms)) { a.world.schedule(event); a.observer.recordEvent(event); }
    this.scheduled.push(event);
    const support = EVENT_SUPPORT[event.type];
    const summary = describeEvent(event, 'accepted');
    this.log('accepted', summary, support);
    return { ok: true, event, summary, support };
  }

  private fail(error: string): DispatchResult { this.log('error', error); return { ok: false, error }; }

  movementAt(tick = this.tick) { return currentMovement(this.planScore(), tick); }
}

export function describeEvent(e: EnvEvent, phase: 'accepted' | 'applied'): string {
  const at = phase === 'accepted' ? ` → both worlds at tick ${e.tick}` : '';
  switch (e.type) {
    case 'KILL': return `${phase === 'applied' ? 'Applied' : 'Scheduled'} KILL of ${e.ids.length} drone${e.ids.length === 1 ? '' : 's'}${e.ids.length <= 6 ? ` [${e.ids.join(', ')}]` : ''}${at}`;
    case 'JAM_ON': return `${phase === 'applied' ? 'Jam active' : 'Scheduled JAM_ON'} ${e.id}, r = ${e.radius} m at (${e.centre.map(v => v.toFixed(0)).join(', ')})${at}`;
    case 'JAM_OFF': return `${phase === 'applied' ? 'Jam lifted' : 'Scheduled JAM_OFF'} ${e.id}${at}`;
    case 'PARTITION_ON': return `${phase === 'applied' ? 'Partition active: groups fixed' : 'Scheduled PARTITION_ON'}${at}`;
    case 'PARTITION_OFF': return `${phase === 'applied' ? 'Partition removed' : 'Scheduled PARTITION_OFF'}${at}`;
    case 'SET_LOSS': return `${phase === 'applied' ? 'Packet loss now' : 'Scheduled SET_LOSS'} ${(e.loss * 100).toFixed(0)}%${at}`;
    case 'INJECT_SCORE': return phase === 'applied'
      ? `Uplink delivered to drone ${e.droneId}: score v${vkey(e.score.version)} in its inbox. Spread now depends on radio.`
      : `Scheduled INJECT_SCORE v${vkey(e.score.version)} into drone ${e.droneId}${at}. Static arm will ignore it (capability difference).`;
  }
}
