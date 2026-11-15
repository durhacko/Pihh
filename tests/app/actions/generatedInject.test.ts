// GF-WP-11 (#214): injectGeneratedRecipe takes a recipe, not a draft, and uses the existing controller path: one
// INJECT_SCORE into one drone, then gossip over the radio. Real worlds, real controller (inject.test.ts pattern).
// Until GF-WP-07 lands, the recipe here is an existing kind; the path does not depend on the kind.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPERATOR, type EnvEvent, type Recipe, type ScoreMsg } from '../../../src/contracts';
import { encoreBrain } from '../../../src/agent/encoreBrain';
import { createActionController } from '../../../src/app/actions';
import { resetViewMode } from '../../../src/app/render/colourModes/viewMode';
import { adoption, Drafts, type ComposeContext } from '../../../src/app/ui/Composer';
import { GENERATED_SENT_ID, injectGeneratedRecipe } from '../../../src/app/ui/generatedInject';
import { Store } from '../../../src/app/ui/store';
import { controlContext, createWorlds, viewModeDisplay } from '../../../src/app/worlds';

afterEach(() => { resetViewMode(); vi.restoreAllMocks(); });

function setup(seed = 11, n0 = 40) {
  const worlds = createWorlds({ seed, n0, brains: { encore: encoreBrain } });
  worlds.stepBoth();
  const transport = { playing: true, speed: 1 };
  const controller = createActionController(controlContext(worlds, {
    getSnapshots: () => worlds.latest() ?? worlds.stepBoth(),
    getTransport: () => ({ ...transport, seed: worlds.seed }),
    setPlaying: playing => { transport.playing = playing; },
    setSpeed: speed => { transport.speed = speed; },
    reset: next => { worlds.reset(next); worlds.stepBoth(); },
    display: viewModeDisplay,
  }));
  const ctx: ComposeContext = { controller, store: new Store(), drafts: new Drafts(), params: worlds.params, snapshots: () => worlds.latest()!, samples: () => worlds.samples() };
  const drafts = ctx.drafts.list.map(d => ({ ...d }));
  return { worlds, controller, ctx, drafts, step(n = 1) { for (let i = 0; i < n; i++) worlds.stepBoth(); } };
}
const injects = (log: EnvEvent[]) => log.filter((e): e is Extract<EnvEvent, { type: 'INJECT_SCORE' }> => e.type === 'INJECT_SCORE');
const RECIPE: Recipe = { kind: 'helix' };

describe('injectGeneratedRecipe: one drone, then gossip', () => {
  it('schedules exactly one INJECT_SCORE into the chosen drone, with the recipe as the new movement', async () => {
    const fx = setup();
    fx.ctx.store.set({ preview: { recipe: { kind: 'sphere' }, label: 'fixture' } });
    const outcome = await injectGeneratedRecipe(fx.ctx, RECIPE, 7, 'Rocket');
    expect(outcome.status).toBe('done');
    const log = injects(fx.controller.getEventLog());
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ droneId: 7 });
    expect(log[0]!.score.movements.at(-1)!.recipe).toEqual(RECIPE);
    expect(log[0]!.score.version.origin).toBe(7);
    expect(outcome.sent).toEqual({ key: `${log[0]!.score.version.issuedTick}:7`, name: 'Rocket', draftId: GENERATED_SENT_ID, droneId: 7, tick: log[0]!.tick });
    expect(fx.ctx.store.state.preview).toBeNull();                 // the preview gives way to the flown formation
    expect(fx.ctx.drafts.list.map(d => ({ ...d }))).toEqual(fx.drafts);   // no draft is created or marked
  });

  it('the uplink reaches only that drone; the rest learn it over the radio, and the observer counts adoption', async () => {
    const fx = setup();
    const { sent } = await injectGeneratedRecipe(fx.ctx, RECIPE, 7, 'Rocket');
    const event = injects(fx.controller.getEventLog())[0]!;
    const uplinks: number[] = [];
    let fromDrones = 0;
    while (fx.worlds.tick < event.tick + 200) {
      fx.step();
      for (let id = 0; id < fx.worlds.params.n0; id++) {
        for (const m of fx.worlds.worlds.encore.inspect(id)?.input.inbox ?? []) {
          if (m.type !== 'SCORE') continue;
          if ((m as ScoreMsg).from === OPERATOR) uplinks.push(id); else fromDrones++;
        }
      }
    }
    expect(uplinks).toEqual([7]);                                   // one operator uplink, into the chosen drone
    expect(fromDrones).toBeGreaterThan(0);                          // gossip carried it on
    const reading = adoption(fx.worlds.samples(), sent!);
    expect(reading.state).toBe('measured');
    expect(reading.encore!.count).toBeGreaterThan(1);               // adopted beyond the uplinked drone
    expect(reading.static?.count ?? 0).toBe(0);                     // the static baseline never relays or adopts
  });

  it('never moves a drone: positions before the injection tick are those of a run without it', async () => {
    const a = setup();
    const b = setup();
    await injectGeneratedRecipe(a.ctx, RECIPE, 7, 'Rocket');
    const tick = injects(a.controller.getEventLog())[0]!.tick;
    while (a.worlds.tick < tick) { a.step(); b.step(); }
    expect(a.worlds.latest()!.encore.drones.map(d => d.pos)).toEqual(b.worlds.latest()!.encore.drones.map(d => d.pos));
  });

  it('refuses a bad drone id and a dead drone, and sends nothing', async () => {
    const fx = setup();
    expect((await injectGeneratedRecipe(fx.ctx, RECIPE, -1, 'x')).status).toBe('failed');
    expect((await injectGeneratedRecipe(fx.ctx, RECIPE, 1.5, 'x')).status).toBe('failed');
    expect((await injectGeneratedRecipe(fx.ctx, RECIPE, 999, 'x')).status).toBe('failed');
    expect(fx.controller.handle({ type: 'kill-ids', ids: [3] }).ok).toBe(true);
    fx.step(2);
    expect(fx.worlds.latest()!.encore.drones[3]!.alive).toBe(false);   // the case below really is a dead drone
    expect((await injectGeneratedRecipe(fx.ctx, RECIPE, 3, 'x')).status).toBe('failed');
    expect(injects(fx.controller.getEventLog())).toHaveLength(0);
  });
});
