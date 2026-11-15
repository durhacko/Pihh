// GF-WP-11 (#214) end to end on a REAL generated recipe (GF-CC-01, #215): an accepted fixture scene →
// makeGeneratedRecipe → injectPreflight → injectGeneratedRecipe into ONE selected drone → gossip over the existing
// radio (a partition is respected) → provenance from the run's events → replay re-derives the same formation →
// the event log replays to the same stateHash. And the controller refuses a tampered scene, whatever the caller.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeParams, OPERATOR, type EnvEvent, type GeneratedRecipe, type ScoreMsg } from '../../../src/contracts';
import { encoreBrain } from '../../../src/agent/encoreBrain';
import { createActionController } from '../../../src/app/actions';
import { adoption, Drafts, type ComposeContext } from '../../../src/app/ui/Composer';
import { injectGeneratedRecipe } from '../../../src/app/ui/generatedInject';
import { Store } from '../../../src/app/ui/store';
import { controlContext, createWorlds, viewModeDisplay } from '../../../src/app/worlds';
import { versionKey } from '../../../src/app/render/colourModes/belief';
import { checkReplayLog, generatedProvenance, injectPreflight, makeReplayLog, parseReplayLog, replayFromProvenance, serializeReplayLog, type GeneratedProvenance } from '../../../src/cli/generated';
import { expandRecipeStrict, makeGeneratedRecipe } from '../../../src/score';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const N0 = 40;
const SEED = 11;
const params = makeParams(N0);

/** The first committed valid fixture scene that compiles at n0 40 (sorted by file name, so the choice is fixed). */
const accepted = (() => {
  const dir = resolve(root, 'tests/fixtures/scenes');
  for (const file of readdirSync(dir).filter(f => f.startsWith('valid-')).sort()) {
    const scene = JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as unknown;
    const made = makeGeneratedRecipe(scene, N0, params);
    if (made.ok) return { file, scene, recipe: made.recipe };
  }
  throw new Error('no committed fixture compiles at n0 40');
})();
const provenanceOf = (r: GeneratedRecipe): GeneratedProvenance => ({ sceneHash: r.sceneHash, compilerVersion: r.compilerVersion, slotsDigest: r.slotsDigest.digest, n0: r.slotsDigest.n0, slotSpacingMin: r.slotsDigest.slotSpacingMin, title: r.scene.title, source: 'fixture', fixture: accepted.file });

function live() {
  const worlds = createWorlds({ seed: SEED, n0: N0, brains: { encore: encoreBrain } });
  worlds.stepBoth();
  const transport = { playing: true, speed: 1 };
  const controller = createActionController(controlContext(worlds, {
    getSnapshots: () => worlds.latest() ?? worlds.stepBoth(),
    getTransport: () => ({ ...transport, seed: worlds.seed }),
    setPlaying: p => { transport.playing = p; }, setSpeed: s => { transport.speed = s; },
    reset: next => { worlds.reset(next); worlds.stepBoth(); }, display: viewModeDisplay,
  }));
  const ctx: ComposeContext = { controller, store: new Store(), drafts: new Drafts(), params: worlds.params, snapshots: () => worlds.latest()!, samples: () => worlds.samples() };
  return { worlds, controller, ctx, step(n = 1) { for (let i = 0; i < n; i++) worlds.stepBoth(); } };
}
const injects = (log: EnvEvent[]) => log.filter((e): e is Extract<EnvEvent, { type: 'INJECT_SCORE' }> => e.type === 'INJECT_SCORE');
const hashes = (w: ReturnType<typeof createWorlds>) => ({ encore: w.worlds.encore.stateHash(), static: w.worlds.static.stateHash() });

describe('GF-WP-11 end to end with a generated recipe', () => {
  it('accept → preflight → inject into one drone → gossip → adoption → provenance → replay, same formation', async () => {
    const fx = live();
    expect(injectPreflight(accepted.scene, provenanceOf(accepted.recipe), params).ok).toBe(true);
    fx.step(20);
    const outcome = await injectGeneratedRecipe(fx.ctx, accepted.recipe, 7, accepted.recipe.scene.title);
    expect(outcome.status, outcome.message).toBe('done');
    const [event] = injects(fx.controller.getEventLog());
    expect(event!.droneId).toBe(7);
    expect(event!.score.movements.at(-1)!.recipe).toMatchObject({ kind: 'generated', sceneHash: accepted.recipe.sceneHash });

    const uplinks: number[] = [];
    while (fx.worlds.tick < event!.tick + 260) {
      fx.step();
      for (let id = 0; id < N0; id++) for (const m of fx.worlds.worlds.encore.inspect(id)?.input.inbox ?? []) {
        if (m.type === 'SCORE' && (m as ScoreMsg).from === OPERATOR) uplinks.push(id);
      }
    }
    expect(uplinks).toEqual([7]);                                         // one operator uplink, into the one drone
    const reading = adoption(fx.worlds.samples(), outcome.sent!);
    expect(reading.encore!.count).toBeGreaterThan(N0 / 2);                // adopted by gossip, not by the UI
    expect(reading.static?.count ?? 0).toBe(0);

    const rows = generatedProvenance({ events: fx.controller.getEventLog() });
    expect(rows).toEqual([{ tick: event!.tick, droneId: 7, sceneHash: accepted.recipe.sceneHash, compilerVersion: accepted.recipe.compilerVersion, slotsDigest: accepted.recipe.slotsDigest.digest, n0: N0, slotSpacingMin: params.slotSpacingMin, title: accepted.recipe.scene.title }]);
    const replay = replayFromProvenance(accepted.recipe.scene, { ...rows[0]!, source: 'fixture' });
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.formation.slots).toEqual(expandRecipeStrict(accepted.recipe, N0, params).slots);   // the formation the swarm flies
  }, 60_000);

  it('gossip respects a partition: the score stays on the injected drone’s side', async () => {
    const fx = live();
    expect(fx.controller.handle({ type: 'partition' }).ok).toBe(true);
    fx.step(5);
    const side = (id: number) => fx.worlds.latest()!.encore.drones[id]!.partitionSide;
    const target = [...Array(N0).keys()].find(id => side(id) !== null && fx.worlds.latest()!.encore.drones[id]!.alive)!;
    const outcome = await injectGeneratedRecipe(fx.ctx, accepted.recipe, target, 'x');
    expect(outcome.status, outcome.message).toBe('done');
    const key = outcome.sent!.key;
    fx.step(300);
    const drones = fx.worlds.latest()!.encore.drones;
    const holders = drones.filter(d => d.alive && versionKey(d.belief.version) === key);
    expect(holders.length).toBeGreaterThan(1);
    expect(holders.every(d => d.partitionSide === side(target))).toBe(true);   // none across the partition
  }, 60_000);

  it('a reset and the saved event log reproduce the run exactly (same stateHash, both arms)', async () => {
    const fx = live();
    fx.step(20);
    expect((await injectGeneratedRecipe(fx.ctx, accepted.recipe, 7, 'x')).status).toBe('done');
    while (fx.worlds.tick < 300) fx.step();
    const end = hashes(fx.worlds);
    const text = serializeReplayLog(makeReplayLog(SEED, fx.worlds.params, fx.controller.getEventLog()));
    const checked = checkReplayLog(parseReplayLog(text), params);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const replay = createWorlds({ seed: checked.log.seed, n0: N0, brains: { encore: encoreBrain }, events: checked.log.events });
    while (replay.tick < 300) replay.stepBoth();
    expect(hashes(replay)).toEqual(end);
    // The same log with the scene tampered is refused before scheduling.
    const tampered = JSON.parse(text) as { events: { score: { movements: { recipe: { scene: { title: string } } }[] } }[] };
    tampered.events[0]!.score.movements.at(-1)!.recipe.scene.title = 'tampered';
    const refused = checkReplayLog(tampered, params);
    expect(refused.ok ? 'ok' : refused.reason).toBe('scene');
  }, 60_000);

  it('the controller refuses a tampered or other-compiler generated recipe, whatever the caller', () => {
    const fx = live();
    fx.controller.handle({ type: 'select', id: 7 });
    const tampered: GeneratedRecipe = { ...accepted.recipe, scene: { ...accepted.recipe.scene, title: 'not what was hashed' } };
    const r1 = fx.controller.handle({ type: 'inject', recipe: tampered });
    expect(r1.ok).toBe(false);
    expect(r1.message).toMatch(/hash-mismatch/);
    const r2 = fx.controller.handle({ type: 'inject', recipe: { ...accepted.recipe, compilerVersion: accepted.recipe.compilerVersion + 1 } });
    expect(r2.ok).toBe(false);
    expect(r2.message).toMatch(/compiler-mismatch/);
    expect(injects(fx.controller.getEventLog())).toHaveLength(0);
    expect(fx.controller.handle({ type: 'inject', recipe: accepted.recipe }).ok).toBe(true);   // the honest recipe goes through
  });
});
