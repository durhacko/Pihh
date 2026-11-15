// P2-WP-01 step 7: the canonical 90 s demo script, run headless over the app's own control path (as
// tests/app/demo.test.ts drives it), with the invariant checkers on both worlds. Opt-in (P2_WIDE=1): it steps two
// 200-drone worlds for 1800 ticks. It prints every violation with its knownLimit tag, and the storyboard's P2-B1
// measured row. "Checked properties on this run, not proofs."
import { describe, expect, it } from 'vitest';
import type { EnvEvent, Score, Vec3, WorldSnapshot } from '../../src/contracts';
import { currentMovement, expandRecipe } from '../../src/score';
import { bindControls } from '../../src/app/actions';
import { resetViewMode } from '../../src/app/render/colourModes/viewMode';
import { controlContext, createWorlds, viewModeDisplay, type Pair } from '../../src/app/worlds';
import { connectDemo, DEMO_SEED, DEMO_TICKS } from '../../src/app/ui/DemoScript';
import { versionKey } from '../../src/observer/measure';
import { createInvariantChecker, type InvariantChecker, type Violation } from '../../src/observer/invariants';

const WIDE = process.env.P2_WIDE === '1';

describe.runIf(WIDE)('P2_WIDE: the scripted demo, headless, with the invariant checkers (both arms)', () => {
  it('runs the demo to the end and prints violations and the P2-B1 row', () => {
    resetViewMode();
    const worlds = createWorlds({ seed: DEMO_SEED });
    const scores = new Map<string, Score>();
    let checkers!: Pair<InvariantChecker>;
    const fresh = () => {
      checkers = {
        encore: createInvariantChecker({ params: worlds.params, arm: 'encore' }),
        static: createInvariantChecker({ params: worlds.params, arm: 'static' }),
      };
      scores.clear();
      scores.set(versionKey(worlds.score.version), worlds.score);
      for (const c of Object.values(checkers)) c.registerScore(worlds.score);
    };
    const feed = (s: Pair<WorldSnapshot>) => { violations.push(...checkers.encore.ingest(s.encore), ...checkers.static.ingest(s.static)); watch(s.encore); };
    // Every event the demo schedules reaches the checkers (and every injected score), exactly as it reaches the observers.
    const scheduleBoth = worlds.scheduleBoth.bind(worlds);
    worlds.scheduleBoth = (event: EnvEvent) => {
      scheduleBoth(event);
      if (event.type === 'INJECT_SCORE') { scores.set(versionKey(event.score.version), event.score); for (const c of Object.values(checkers)) c.registerScore(event.score); }
      for (const c of Object.values(checkers)) c.recordEvent(event);
    };
    const violations: Violation[] = [];

    // P2-B1 measured row (Encore): slot changes, commits and pops, chain depth (deepest observed history stack),
    // first and last commit tick, first and last arrow tick (the drone within rOcc of its new target, on snapshot positions).
    const row = { changes: 0, commits: 0, pops: 0, depth: 0, firstCommit: null as number | null, lastCommit: null as number | null, firstArrow: null as number | null, lastArrow: null as number | null };
    const prevSlot = new Map<number, number>();
    const stackDepth = new Map<number, number>();
    const awaiting = new Map<number, number>();   // drone -> slot it changed to, until it arrives
    function watch(s: WorldSnapshot) {
      for (const d of s.drones) {
        if (!d.alive) { awaiting.delete(d.id); continue; }
        const from = prevSlot.get(d.id) ?? d.id;
        const to = d.belief.slot;
        if (to !== from) {
          row.changes++;
          if (to < from) { row.commits++; row.firstCommit ??= s.tick; row.lastCommit = s.tick; stackDepth.set(d.id, (stackDepth.get(d.id) ?? 0) + 1); }
          else { row.pops++; stackDepth.set(d.id, Math.max(0, (stackDepth.get(d.id) ?? 0) - 1)); }
          row.depth = Math.max(row.depth, stackDepth.get(d.id) ?? 0);
          awaiting.set(d.id, to);
        }
        prevSlot.set(d.id, to);
        const target = awaiting.get(d.id);
        const score = scores.get(versionKey(d.belief.version));
        if (target !== undefined && score) {
          const p = expandRecipe(currentMovement(score, s.tick).movement.recipe, worlds.params.n0, worlds.params).slots[target].pos as Vec3;
          if (Math.hypot(d.pos[0] - p[0], d.pos[1] - p[1], d.pos[2] - p[2]) < worlds.params.rOcc) {
            row.firstArrow ??= s.tick; row.lastArrow = s.tick; awaiting.delete(d.id);
          }
        }
      }
    }

    fresh();
    feed(worlds.stepBoth());
    const transport = { playing: true, speed: 1 };
    const host = new EventTarget() as unknown as HTMLElement;
    const controls = bindControls(host, controlContext(worlds, {
      getSnapshots: () => worlds.latest() ?? worlds.stepBoth(),
      getTransport: () => ({ ...transport, seed: worlds.seed }),
      setPlaying: (playing) => { transport.playing = playing; },
      setSpeed: (speed) => { transport.speed = speed; },
      // A reset rebuilds both worlds: the checkers and the P2-B1 row restart with them.
      reset: (next) => { worlds.reset(next); fresh(); violations.length = 0; prevSlot.clear(); stackDepth.clear(); awaiting.clear(); Object.assign(row, { changes: 0, commits: 0, pops: 0, depth: 0, firstCommit: null, lastCommit: null, firstArrow: null, lastArrow: null }); feed(worlds.stepBoth()); },
      display: viewModeDisplay,
    }));
    const demo = connectDemo(host, { camera: () => {}, changed: () => {} });
    expect(demo.runner.start()).toBe(true);
    while (worlds.tick < DEMO_TICKS.END) {
      feed(worlds.stepBoth());
      controls.refresh();
    }
    const lines = [`demo seed ${worlds.seed}, ticks 1-${worlds.tick}`];
    for (const arm of ['encore', 'static'] as const) {
      const r = checkers[arm].report();
      lines.push(`${arm}: checked ${r.checked.join(', ')}; holding ${r.holding.join(', ') || 'none'}; counterexamples ${r.counterexamples.length}; known-limit instances ${r.knownLimitInstances.length}; unavailable ${r.unavailable.map((u) => u.inv).join(', ') || 'none'}`);
      for (const v of r.violations) lines.push(`  ${v.inv} t=${v.tick} ids=${v.ids.join(',')} slot=${v.slot ?? '-'} tag=${v.knownLimit ?? 'none'}: ${v.detail}`);
    }
    lines.push(`P2-B1 measured (Encore): slot changes ${row.changes}, commits ${row.commits}, pops ${row.pops}, chain depth ${row.depth}, commit ticks ${row.firstCommit}-${row.lastCommit}, arrow ticks ${row.firstArrow}-${row.lastArrow}`);
    console.log(lines.join('\n'));
    expect(worlds.seed).toBe(DEMO_SEED);
    resetViewMode();
  }, 600_000);
});
