import { describe, expect, it } from 'vitest';
import type { EnvEvent, Score } from '../../src/contracts';
import { calculateSummary } from '../../src/observer/summary';
import type { SummaryContext, SummaryMetrics, SummarySample, SummaryTick } from '../../src/observer/summary';

function sample(tick: number, values: Partial<SummaryMetrics> = {}, inHold = true, capacityLoss = 0.2, coordLoss = 0.1): SummarySample {
  return { inHold, capacityLoss, coordLoss, metrics: {
    tick, alive: 8, coverage: 0.8, pwc: 0.7, npwc: 0.875, sfMean: 2, sfMax: 5, dupSlots: 0,
    versions: { '0:-1': 8 }, msgs: { hb: 0, score: 0, delivered: 0, lost: 0, blocked: 0 }, collisions: 0, nearMisses: 0, slotChanges: 0,
    ...values,
  } };
}
const base = (overrides: Partial<SummaryContext> = {}): SummaryContext => ({
  tick: 1800, events: [], samples: [], timeline: [], slotChanges: [], adoptions: [], finalLive: [], newestRegisteredVersion: '0:-1',
  totals: { msgs: { hb: 0, score: 0, delivered: 0, lost: 0, blocked: 0 }, collisions: 0, nearMisses: 0 }, ...overrides,
});
const kill: EnvEvent = { type: 'KILL', tick: 400, ids: [1] };
const recipe: Score = { version: { issuedTick: 400, origin: 1 }, movements: [{ startTick: 0, transitionTicks: 0, recipe: { kind: 'sphere' } }] };
const inject: EnvEvent = { type: 'INJECT_SCORE', tick: 400, droneId: 1, score: recipe };
const off: EnvEvent = { type: 'PARTITION_OFF', tick: 700, id: 'p' };
const ticks = (from: number, to: number, versions: Record<string, number> = { '0:-1': 8 }, alive = 8): SummaryTick[] => Array.from({ length: to - from + 1 }, (_, index) => ({ tick: from + index, alive, versions: { ...versions } }));

describe('pure run summary', () => {
  it('averages only hold samples inside the exact endA/end windows and splits capacity/coordination loss', () => {
    const summary = calculateSummary(base({ samples: [
      sample(799, { npwc: 0, sfMax: 99 }), sample(800, { npwc: 0.6, sfMax: 4 }), sample(895, { npwc: 1, sfMax: 6 }),
      sample(850, { npwc: 0, sfMax: 90 }, false), sample(900, { npwc: 0, sfMax: 99 }),
      sample(1700, { npwc: 0.8, coverage: 0.6, sfMean: 2, sfMax: 6 }, true, 0.2, 0.3),
      sample(1795, { npwc: 1, coverage: 0.8, sfMean: 4, sfMax: 8 }, true, 0.4, 0.1),
      sample(1750, { npwc: 0, coverage: 0, sfMean: 100, sfMax: 100 }, false),
      sample(1800, { npwc: 0, sfMean: 100, sfMax: 100 }),
    ] }));
    expect(summary.npwcEndA).toBeCloseTo(0.8); expect(summary.sfMaxEndA).toBe(5);
    expect(summary.npwcEnd).toBeCloseTo(0.9); expect(summary.coverageEnd).toBeCloseTo(0.7);
    expect(summary.sfMeanEnd).toBe(3); expect(summary.sfMaxEnd).toBe(7);
    expect(summary.capacityLoss).toBeCloseTo(0.3); expect(summary.coordLoss).toBeCloseTo(0.2);
  });
  it('reports exactly3s from kill to the first twelve consecutive quarter-second good hold samples', () => {
    const samples = Array.from({ length: 24 }, (_, index) => sample(400 + 5 * index, { npwc: index < 12 ? 0.5 : 0.95 }));
    expect(calculateSummary(base({ events: [kill], samples })).tRec).toBe(3);
    expect(calculateSummary(base({ events: [kill], samples: samples.slice(0, -1) })).tRec).toBeNull();
  });
  it('resets the recovery streak on a gap or a transition, and leaves missing/censored runs null', () => {
    const samples = [sample(400, { npwc: 0.5 }), ...Array.from({ length: 18 }, (_, index) => sample(405 + index * 5, { npwc: 1 }))];
    expect(calculateSummary(base({ events: [kill], samples })).tRec).toBe(0.25);
    const transition = samples.map(entry => entry.metrics.tick === 440 ? { ...entry, inHold: false } : entry);
    expect(calculateSummary(base({ events: [kill], samples: transition })).tRec).toBeNull();
    const gap = samples.filter(entry => entry.metrics.tick !== 440);
    expect(calculateSummary(base({ events: [kill], samples: gap })).tRec).toBeNull();
    expect(calculateSummary(base({ events: [kill], samples: [sample(400, { npwc: 0.5 })] })).tRec).toBeNull();
    expect(calculateSummary(base({ events: [kill] })).tRec).toBeNull();
  });
  it('returns0 for never-below recovery, omits tRec without an appliedKILL and ignores future events', () => {
    expect(calculateSummary(base({ events: [kill], samples: [sample(400, { npwc: 1 })] })).tRec).toBe(0);
    expect(calculateSummary(base())).not.toHaveProperty('tRec');
    expect(calculateSummary(base({ tick: 399, events: [kill] }))).not.toHaveProperty('tRec');
  });
  it('integrates hold deficits/duplicates only after the event and uses exact whole-run counters', () => {
    const summary = calculateSummary(base({ tick: 1000, events: [kill], samples: [
      sample(395, { npwc: 0.5, dupSlots: 2 }), sample(400, { npwc: 0.5, dupSlots: 4 }),
      sample(405, { npwc: 0.75, dupSlots: 1 }), sample(410, { npwc: 0, dupSlots: 100 }, false), sample(415, { npwc: 1, dupSlots: 0 }),
    ], slotChanges: [{ tick: 100, id: 0 }, { tick: 800, id: 1 }, { tick: 801, id: 0 }, { tick: 900, id: 0 }, { tick: 1001, id: 0 }], totals: {
      collisions: 3, nearMisses: 5, msgs: { hb: 0, score: 0, delivered: 0, lost: 0, blocked: 0 },
    } }));
    expect(summary.npwcDeficitSec).toBeCloseTo(0.1875); expect(summary.dupSlotSec).toBe(1.75);
    expect(summary.slotChanges).toBe(4); expect(summary.slotChangesMaxDrone).toBe(3); expect(summary.lateSlotChanges).toBe(2);
    expect(summary.dupSlotsEnd).toBe(0); expect(summary.collisions).toBe(3); expect(summary.nearMisses).toBe(5);
  });
  it('computes whole-run message denominators from every tick and preserves undefined ratios', () => {
    const summary = calculateSummary(base({ tick: 20, timeline: [...ticks(1, 10, { '0:-1': 10 }, 10), ...ticks(11, 20, { '0:-1': 6 }, 6)], totals: {
      msgs: { hb: 24, score: 8, delivered: 12, lost: 4, blocked: 8 }, collisions: 0, nearMisses: 0,
    } }));
    expect(summary.msgsPerDroneSec).toBe(4); expect(summary.deliveryRatio).toBe(0.5);
    expect(calculateSummary(base()).msgsPerDroneSec).toBeNull();
    expect(calculateSummary(base()).deliveryRatio).toBeNull();
    expect(calculateSummary(base({ tick: 1, timeline: ticks(1, 1, {}, 0) })).msgsPerDroneSec).toBeNull();
  });
  it('measures observed adoption delays among final live adopters and counts final unadopted drones', () => {
    const summary = calculateSummary(base({ events: [inject], newestRegisteredVersion: '400:1',
      finalLive: [{ id: 0, version: '400:1' }, { id: 1, version: '400:1' }, { id: 2, version: '0:-1' }],
      adoptions: [{ tick: 420, id: 0, version: '400:1' }, { tick: 400, id: 1, version: '400:1' }, { tick: 410, id: 3, version: '400:1' }],
    }));
    expect(summary.adoptP50).toBe(0.5); expect(summary.adoptMax).toBe(1); expect(summary.unadopted).toBe(1);
    const staticSummary = calculateSummary(base({ events: [inject], newestRegisteredVersion: '400:1', finalLive: [{ id: 0, version: '0:-1' }] }));
    expect(staticSummary.adoptP50).toBeNull(); expect(staticSummary.adoptMax).toBeNull(); expect(staticSummary.unadopted).toBe(1);
  });
  it('does not invent adoption times from final beliefs or use unrelated injection baselines', () => {
    const context = base({ events: [inject], newestRegisteredVersion: '400:1', finalLive: [{ id: 0, version: '400:1' }] });
    expect(calculateSummary(context).adoptP50).toBeNull();
    expect(calculateSummary({ ...context, newestRegisteredVersion: '800:2', adoptions: [{ tick: 810, id: 0, version: '800:2' }] }).adoptMax).toBeNull();
    expect(calculateSummary(base({ newestRegisteredVersion: null })).unadopted).toBeNull();
  });
  it('integrates exact split duration and measures final stable convergence after the last reconnection', () => {
    const summary = calculateSummary(base({ tick: 710, events: [off], timeline: [
      ...ticks(695, 702, { '0:-1': 4, '400:1': 4 }), ...ticks(703, 704, { '400:1': 8 }),
      ...ticks(705, 705, { '0:-1': 4, '400:1': 4 }), ...ticks(706, 710, { '400:1': 8 }),
    ] }));
    expect(summary.splitSec).toBeCloseTo(0.45); expect(summary.tVersion).toBeCloseTo(0.3);
    expect(calculateSummary(base({ tick: 710, events: [off], timeline: ticks(700, 710) })).tVersion).toBe(0);
    expect(calculateSummary(base({ tick: 710, events: [off], timeline: ticks(700, 710, { a: 4, b: 4 }) })).tVersion).toBeNull();
    expect(calculateSummary(base({ tick: 710, timeline: ticks(700, 710) })).tVersion).toBeNull();
    expect(calculateSummary(base({ tick: 710, events: [off], timeline: ticks(700, 710, {}, 0) })).tVersion).toBeNull();
  });
  it('skips owner-approved nullable samples in mixed windows and returnsnull for an all-null metric window', () => {
    const empty = { npwc: null, sfMean: null, sfMax: null, alive: 0 };
    const summary = calculateSummary(base({ samples: [sample(1700, { npwc: 0.8, sfMean: 1, sfMax: 3 }), sample(1705, empty), sample(1710, { npwc: 1, sfMean: 3, sfMax: 7 })] }));
    expect(summary.npwcEnd).toBeCloseTo(0.9); expect(summary.sfMeanEnd).toBe(2); expect(summary.sfMaxEnd).toBe(5);
    const allNull = calculateSummary(base({ samples: [sample(800, empty), sample(1700, empty), sample(1705, empty)] }));
    expect(allNull.npwcEndA).toBeNull(); expect(allNull.sfMaxEndA).toBeNull();
    expect(allNull.npwcEnd).toBeNull(); expect(allNull.sfMeanEnd).toBeNull(); expect(allNull.sfMaxEnd).toBeNull();
    expect(calculateSummary(base()).npwcEnd).toBeNull();
  });
  it('treats null recovery samples as gaps and censors an empty swarm rather than claiming recovery', () => {
    const good = Array.from({ length: 18 }, (_, index) => sample(405 + index * 5, { npwc: 1 }));
    const context = base({ events: [kill], samples: [sample(400, { npwc: 0.5 }), ...good] });
    expect(calculateSummary(context).tRec).toBe(0.25);
    expect(calculateSummary({ ...context, samples: context.samples.map(entry => entry.metrics.tick === 440 ? sample(440, { npwc: null, alive: 0 }) : entry) }).tRec).toBeNull();
    expect(calculateSummary(base({ events: [kill], samples: [sample(400, { npwc: null, alive: 0 }), sample(405, { npwc: null, alive: 0 })] })).tRec).toBeNull();
    const afterGap = [sample(400, { npwc: null, alive: 0 }), ...Array.from({ length: 12 }, (_, index) => sample(405 + index * 5, { npwc: 1 }))];
    expect(calculateSummary(base({ events: [kill], samples: afterGap })).tRec).toBe(0.25);
  });
  it('skips null nPWC deficits without treating an empty swarm as complete coordination failure', () => {
    const summary = calculateSummary(base({ events: [kill], samples: [sample(400, { npwc: 0.5 }), sample(405, { npwc: null, alive: 0 }), sample(410, { npwc: 0.75 })] }));
    expect(summary.npwcDeficitSec).toBeCloseTo(0.1875);
    expect(calculateSummary(base({ events: [kill], samples: [sample(400, { npwc: null, alive: 0 })] })).npwcDeficitSec).toBeNull();
  });
  it('is replay-stable, independent of input order, and never changes the supplied evidence', () => {
    const context = base({ events: [inject, kill], samples: [sample(1705), sample(1700)], timeline: ticks(1, 10), slotChanges: [{ tick: 2, id: 1 }], adoptions: [{ tick: 420, id: 1, version: '400:1' }] });
    const before = structuredClone(context);
    const summary = calculateSummary(context);
    expect(calculateSummary(structuredClone(context))).toEqual(summary);
    expect(calculateSummary({ ...context, samples: [...context.samples].reverse(), timeline: [...context.timeline].reverse() })).toEqual(summary);
    expect(context).toEqual(before);
  });
});
