import { DT } from '../contracts';
import type { EnvEvent, MetricsSample, ScoreVersion } from '../contracts';

/** Mirrors the owner-approved empty-swarm metrics while remaining independently testable. */
export type SummaryMetrics = Omit<MetricsSample, 'npwc' | 'sfMean' | 'sfMax'> & {
  npwc: number | null;
  sfMean: number | null;
  sfMax: number | null;
};
export interface SummarySample {
  metrics: SummaryMetrics;
  inHold: boolean;
  capacityLoss: number;
  coordLoss: number;
}
export interface SummaryTick {
  tick: number;
  alive: number;
  versions: Readonly<Record<string, number>>;
}
export interface SummaryContext {
  tick: number;
  events: readonly EnvEvent[];
  samples: readonly SummarySample[];
  /** Every observed simulation tick, including transitions and non-sample ticks. */
  timeline: readonly SummaryTick[];
  slotChanges: readonly { tick: number; id: number }[];
  /** First time each (version,id) was actually observed, not an inferred uplink. */
  adoptions: readonly { tick: number; id: number; version: string }[];
  finalLive: readonly { id: number; version: string }[];
  newestRegisteredVersion: string | null;
  totals: {
    msgs: MetricsSample['msgs'];
    collisions: number;
    nearMisses: number;
  };
}

const SAMPLE_TICKS = 5;
const SAMPLE_SECONDS = SAMPLE_TICKS * DT;
const RECOVERY_SAMPLES = 12;
const key = (version: ScoreVersion): string => `${version.issuedTick}:${version.origin}`;
const versionCount = (versions: Readonly<Record<string, number>>): number => Object.values(versions).filter(count => count > 0).length;
function mean(values: readonly (number | null)[]): number | null {
  const measured = values.filter((value): value is number => value !== null);
  if (!measured.length || measured.some(value => !Number.isFinite(value))) return null;
  return measured.reduce((sum, value) => sum + value, 0) / measured.length;
}
function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function recovery(samples: readonly SummarySample[], killTick: number): number | null {
  const postKill = samples.filter(sample => sample.metrics.tick >= killTick);
  const hold = postKill.filter(sample => sample.inHold);
  if (!hold.length) return null;
  if (hold.every(sample => sample.metrics.npwc !== null && sample.metrics.npwc >= 0.95)) return 0;
  let start: number | null = null;
  let previous: number | null = null;
  let streak = 0;
  for (const sample of postKill) {
    if (!sample.inHold || sample.metrics.npwc === null || sample.metrics.npwc < 0.95 || !Number.isFinite(sample.metrics.npwc)) {
      start = null; previous = null; streak = 0;
      continue;
    }
    if (previous === null || sample.metrics.tick - previous !== SAMPLE_TICKS) {
      start = sample.metrics.tick;
      streak = 0;
    }
    previous = sample.metrics.tick;
    streak++;
    if (streak >= RECOVERY_SAMPLES) return (start! - killTick) * DT;
  }
  return null;
}

function versionRecovery(timeline: readonly SummaryTick[], offTick: number): number | null {
  const afterOff = timeline.filter(entry => entry.tick >= offTick);
  if (!afterOff.length) return null;
  // A temporary convergence followed by another split is not a settled version.
  let settledAt: number | null = null;
  let previous: number | null = null;
  for (const entry of afterOff) {
    if (versionCount(entry.versions) !== 1) settledAt = null;
    else if (settledAt === null || (previous !== null && entry.tick !== previous + 1)) settledAt = entry.tick;
    previous = entry.tick;
  }
  return settledAt === null ? null : (settledAt - offTick) * DT;
}

/** Pure replay-stable summary: all event baselines are supplied explicitly. */
export function calculateSummary(context: SummaryContext): Record<string, number | null> {
  const samples = [...context.samples].filter(entry => entry.metrics.tick <= context.tick).sort((a, b) => a.metrics.tick - b.metrics.tick);
  const timeline = [...context.timeline].filter(entry => entry.tick <= context.tick).sort((a, b) => a.tick - b.tick);
  const events = [...context.events].filter(event => event.tick <= context.tick).sort((a, b) => a.tick - b.tick);
  const hold = samples.filter(entry => entry.inHold);
  const windowA = hold.filter(entry => entry.metrics.tick >= 800 && entry.metrics.tick <= 899);
  const windowEnd = hold.filter(entry => entry.metrics.tick >= 1700 && entry.metrics.tick <= 1799);
  const firstEvent = events[0]?.tick;
  const deficitSamples = firstEvent === undefined ? [] : hold.filter(entry => entry.metrics.tick >= firstEvent && entry.metrics.npwc !== null);
  const lastSample = samples.at(-1)?.metrics;
  const counts = new Map<number, number>();
  for (const change of context.slotChanges) if (change.tick <= context.tick) counts.set(change.id, (counts.get(change.id) ?? 0) + 1);
  const meanAlive = mean(timeline.map(entry => entry.alive));
  const runSeconds = context.tick * DT;
  const messages = context.totals.msgs;
  const candidates = messages.delivered + messages.lost + messages.blocked;
  const summary: Record<string, number | null> = {
    npwcEndA: mean(windowA.map(entry => entry.metrics.npwc)),
    npwcEnd: mean(windowEnd.map(entry => entry.metrics.npwc)),
    coverageEnd: mean(windowEnd.map(entry => entry.metrics.coverage)),
    sfMeanEnd: mean(windowEnd.map(entry => entry.metrics.sfMean)),
    sfMaxEnd: mean(windowEnd.map(entry => entry.metrics.sfMax)),
    sfMaxEndA: mean(windowA.map(entry => entry.metrics.sfMax)),
    capacityLoss: mean(windowEnd.map(entry => entry.capacityLoss)),
    coordLoss: mean(windowEnd.map(entry => entry.coordLoss)),
    npwcDeficitSec: deficitSamples.length ? deficitSamples.reduce((sum, entry) => sum + (1 - entry.metrics.npwc!) * SAMPLE_SECONDS, 0) : null,
    slotChanges: [...counts.values()].reduce((sum, count) => sum + count, 0),
    slotChangesMaxDrone: Math.max(0, ...counts.values()),
    lateSlotChanges: context.slotChanges.filter(change => change.tick <= context.tick && change.tick > context.tick - 200).length,
    dupSlotSec: hold.reduce((sum, entry) => sum + entry.metrics.dupSlots * SAMPLE_SECONDS, 0),
    dupSlotsEnd: lastSample?.dupSlots ?? null,
    collisions: context.totals.collisions,
    nearMisses: context.totals.nearMisses,
    msgsPerDroneSec: meanAlive !== null && meanAlive > 0 && runSeconds > 0 ? (messages.hb + messages.score) / (meanAlive * runSeconds) : null,
    deliveryRatio: candidates > 0 ? messages.delivered / candidates : null,
    adoptP50: null, adoptMax: null, unadopted: null,
    splitSec: timeline.length ? timeline.filter(entry => versionCount(entry.versions) >= 2).length * DT : null,
    tVersion: null,
  };
  const kill = events.find(event => event.type === 'KILL');
  if (kill) summary.tRec = recovery(samples, kill.tick);
  const newest = context.newestRegisteredVersion;
  if (newest !== null) {
    const target = newest;
    summary.unadopted = context.finalLive.filter(drone => drone.version !== target).length;
    const injection = events.find(event => event.type === 'INJECT_SCORE' && key(event.score.version) === target);
    if (injection) {
      const delays: number[] = [];
      for (const drone of context.finalLive) {
        if (drone.version !== target) continue;
        const adoption = context.adoptions.filter(entry => entry.id === drone.id && entry.version === target && entry.tick >= injection.tick && entry.tick <= context.tick).sort((a, b) => a.tick - b.tick)[0];
        if (adoption) delays.push((adoption.tick - injection.tick) * DT);
      }
      summary.adoptP50 = median(delays);
      summary.adoptMax = delays.length ? Math.max(...delays) : null;
    }
  }
  const lastOff = events.filter(event => event.type === 'PARTITION_OFF').at(-1);
  if (lastOff) summary.tVersion = versionRecovery(timeline, lastOff.tick);
  return summary;
}
