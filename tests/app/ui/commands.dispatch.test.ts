// The parser's control steps go straight into the real action controller with real worlds: no translation.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { makeParams, type EnvEvent, type Score } from '../../../src/contracts';
import { composeNext } from '../../../src/score';
import { createWorld, idsInSphere } from '../../../src/sim';
import { createActionController, type ControlContext } from '../../../src/app/actions';
import { staticBrain } from '../../../src/agent/staticBrain';
import * as commands from '../../../src/app/ui/commands';
import { liveState, OPERATOR_JAM_ID, parse, shouldDispatch, withRecipe, type ControlPlan, type Intent } from '../../../src/app/ui/commands';

const score: Score = { version: { issuedTick: 0, origin: -1 }, movements: [{ startTick: 0, transitionTicks: 0, recipe: { kind: 'sphere' } }] };

function setup() {
  const params = makeParams(40);
  const config = (seed: number) => ({ seed, params, score, brain: staticBrain });
  let worlds = { encore: createWorld(config(101)), static: createWorld(config(101)) };
  let snapshots = { encore: worlds.encore.step(), static: worlds.static.step() };
  const transport = { playing: true, speed: 1, seed: 101 };
  const events: EnvEvent[] = [];
  const context: ControlContext = {
    params, getWorlds: () => worlds, getSnapshots: () => snapshots, getScore: () => score, getTransport: () => ({ ...transport }),
    setPlaying: playing => { transport.playing = playing; }, setSpeed: speed => { transport.speed = speed; },
    reset(seed) { transport.seed = seed; worlds = { encore: createWorld(config(seed)), static: createWorld(config(seed)) }; snapshots = { encore: worlds.encore.step(), static: worlds.static.step() }; },
    composeScore: composeNext, radioFaults: true, onScheduledEvent: event => { events.push(event); },
  };
  const controller = createActionController(context);
  return {
    controller, transport, events, params,
    snapshot: () => snapshots.encore,
    step() { snapshots = { encore: worlds.encore.step(), static: worlds.static.step() }; },
    /** What FE-B2 will do: parse, check the precondition, hand each step to the controller. */
    run(line: string) {
      const result = parse(line, { snapshot: snapshots.encore, seed: transport.seed });
      if (!result.ok) throw new Error(result.error);
      const plan = result.intent as ControlPlan;
      if (plan.kind !== 'control') throw new Error(`not a control plan: ${plan.kind}`);
      if (!shouldDispatch(plan, liveState(controller.status(), snapshots.encore, controller.getEventLog()))) return 'already';
      return plan.steps.map(step => controller.handle(step));
    },
  };
}

describe('control intents dispatch through the real action API unchanged', () => {
  it('fault kill --drone N selects and kills that drone in both worlds', () => {
    const fx = setup();
    const results = fx.run('fault kill --drone 7');
    expect(results).not.toBe('already');
    expect((results as { ok: boolean }[]).every(r => r.ok)).toBe(true);
    expect(fx.events).toEqual([{ type: 'KILL', tick: 2, ids: [7] }]);
  });

  it('fault kill-region --at N --radius R kills the same sphere the controller computes', () => {
    const fx = setup();
    const before = fx.snapshot();
    fx.run('fault kill-region --at 4 --radius 3');
    expect(fx.events).toEqual([{ type: 'KILL', tick: 2, ids: idsInSphere(before, before.drones[4].pos, 3) }]);
  });

  it('fault loss, speed and reset reach the controller with the parsed values', () => {
    const fx = setup();
    fx.run('fault loss 20');
    expect(fx.events).toEqual([{ type: 'SET_LOSS', tick: 2, loss: 0.2 }]);
    fx.run('speed 0.5');
    expect(fx.transport.speed).toBe(0.5);
    fx.run('reset --seed 42');
    expect(fx.transport.seed).toBe(42);
  });

  it('play and pause dispatch only when they change something', () => {
    const fx = setup();
    expect(fx.run('play')).toBe('already');
    expect(fx.transport.playing).toBe(true);
    fx.run('pause');
    expect(fx.transport.playing).toBe(false);
    expect(fx.run('pause')).toBe('already');
    fx.run('play');
    expect(fx.transport.playing).toBe(true);
  });

  it('jam, unjam and partition on/off follow the snapshot state', () => {
    const fx = setup();
    expect(fx.run('fault unjam')).toBe('already');
    fx.run('fault jam --at 4 --radius 10');
    fx.step(); fx.step();
    expect(fx.snapshot().jams).toHaveLength(1);
    expect(fx.run('fault jam --at 4')).toBe('already');
    fx.run('fault unjam');
    fx.step(); fx.step();
    expect(fx.snapshot().jams).toHaveLength(0);
    fx.run('fault partition on');
    fx.step(); fx.step();
    expect(fx.snapshot().partitions).toHaveLength(1);
    expect(fx.run('fault partition on')).toBe('already');
    fx.run('fault partition off');
    expect(fx.events.map(e => e.type)).toEqual(['JAM_ON', 'JAM_OFF', 'PARTITION_ON', 'PARTITION_OFF']);
  });

  it('on/off stays idempotent while a toggle is scheduled but not yet applied (paused, same tick)', () => {
    const fx = setup();
    fx.run('pause');
    fx.run('fault jam --at 4');
    expect(fx.run('fault jam --at 4')).toBe('already');
    fx.run('fault partition on');
    expect(fx.run('fault partition on')).toBe('already');
    expect(fx.events.map(e => e.type)).toEqual(['JAM_ON', 'PARTITION_ON']);
    // an off straight after the pending on is dispatched, and the controller cancels it in the same tick
    fx.run('fault unjam');
    fx.run('fault partition off');
    expect(fx.run('fault unjam')).toBe('already');
    expect(fx.events.map(e => e.type)).toEqual(['JAM_ON', 'PARTITION_ON', 'JAM_OFF', 'PARTITION_OFF']);
    fx.step(); fx.step();
    expect(fx.snapshot().jams).toEqual([]);
    expect(fx.snapshot().partitions).toEqual([]);
  });

  it('a timed toggle pending for a later tick (`at`, as the scripted demo sends) does not count yet: liveState agrees with the controller', () => {
    // Off now, JAM_ON@60 pending: at tick 12 the jam is still off, so `fault unjam` is already in effect. (The old
    // log-order rule called it on, dispatched the toggle, and the controller scheduled a JAM_ON@12.)
    const off = setup();
    expect(off.controller.handle({ type: 'jam', centre: [0, 30, 0], radius: 10, at: 60 }).event).toMatchObject({ type: 'JAM_ON', tick: 60 });
    for (let i = 0; i < 10; i++) off.step();
    expect(off.snapshot().tick).toBe(11);
    expect(liveState(off.controller.status(), off.snapshot(), off.controller.getEventLog()).jam).toBe(false);
    expect(off.run('fault unjam')).toBe('already');
    expect(off.events.map(e => [e.type, e.tick])).toEqual([['JAM_ON', 60]]);

    // On now, JAM_OFF@60 pending: at tick 12 the jam is still on, so `fault jam` is already in effect. (The old rule
    // called it off, dispatched, and the controller scheduled a JAM_OFF@12.)
    const on = setup();
    on.run('fault jam --at 4 --radius 10');
    for (let i = 0; i < 10; i++) on.step();
    expect(on.snapshot().jams).toHaveLength(1);
    expect(on.controller.handle({ type: 'jam', at: 60 }).event).toMatchObject({ type: 'JAM_OFF', tick: 60 });
    expect(liveState(on.controller.status(), on.snapshot(), on.controller.getEventLog()).jam).toBe(true);
    expect(on.run('fault jam --at 4')).toBe('already');
    expect(on.events.map(e => [e.type, e.tick])).toEqual([['JAM_ON', 2], ['JAM_OFF', 60]]);
    // And `fault unjam` now lands as JAM_OFF@12 in the controller, exactly as liveState predicted.
    expect((on.run('fault unjam') as { event?: EnvEvent }[]).map(r => r.event)).toEqual([{ type: 'JAM_OFF', tick: 12, id: OPERATOR_JAM_ID }]);
  });

  it('ignores jams and partitions the controller does not own (scripted ids)', () => {
    const status = { playing: true };
    const snapshot = { tick: 5, jams: [{ id: 'J', centre: [0, 30, 0] as [number, number, number], radius: 12 }], partitions: [{ id: 'P', point: [0, 30, 0] as [number, number, number], normal: [1, 0, 0] as [number, number, number] }] };
    expect(liveState(status, snapshot)).toEqual({ playing: true, jam: false, partition: false });
    const unjam = parse('fault unjam');
    expect(unjam.ok && unjam.intent.kind === 'control' && shouldDispatch(unjam.intent, liveState(status, snapshot))).toBe(false);
    expect(liveState(status, { ...snapshot, jams: [{ ...snapshot.jams[0], id: OPERATOR_JAM_ID }] }).jam).toBe(true);
  });

  it('inject --drone N plus the draft recipe schedules one INJECT_SCORE into that drone', () => {
    const fx = setup();
    const draft = parse('form text "HI"');
    const inject = parse('inject --drone 5', { snapshot: fx.snapshot() });
    expect(draft.ok && inject.ok).toBe(true);
    if (!draft.ok || !inject.ok || draft.intent.kind !== 'draft' || inject.intent.kind !== 'inject') return;
    const plan = withRecipe(inject.intent, draft.intent.recipe);
    expect(plan.steps).toEqual([{ type: 'select', id: 5 }, { type: 'inject', recipe: { kind: 'text', text: 'HI' } }]);
    const results = plan.steps.map(step => fx.controller.handle(step));
    expect(results.every(r => r.ok)).toBe(true);
    expect(fx.events).toHaveLength(1);
    expect(fx.events[0]).toMatchObject({ type: 'INJECT_SCORE', tick: 2, droneId: 5 });
  });
});

describe('safety', () => {
  const source = readFileSync(new URL('../../../src/app/ui/commands.ts', import.meta.url), 'utf8');

  it('the module has no eval, Function constructor, dynamic import, require, shell or DOM access', () => {
    const code = source.replace(/\/\/.*$/gm, '');
    for (const pattern of [/\beval\s*\(/, /\bFunction\s*\(/, /new\s+Function\b/, /\bimport\s*\(/, /\brequire\s*\(/, /child_process/, /\bdocument\b/, /\bwindow\b/, /setTimeout|setInterval/, /\bfetch\s*\(/]) {
      expect(code, String(pattern)).not.toMatch(pattern);
    }
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map(m => m[1]);
    expect(imports).toEqual(['../../contracts', '../../score/font', '../actions']);
  });

  it('never calls eval or the Function constructor, whatever the input', () => {
    const evalSpy = vi.spyOn(globalThis, 'eval');
    const functionSpy = vi.spyOn(globalThis, 'Function');
    const hostile = ['eval("1")', 'eval 1', 'new Function("x")', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'help constructor', 'view __proto__', 'view constructor', 'form text "__proto__"', 'import("fs")', '$(whoami)', '`id`', 'fault kill --drone __proto__', 'help __proto__', 'draft use constructor'];
    for (const line of hostile) {
      const result = parse(line);
      expect(result.ok && !['help', 'ui'].includes(result.intent.kind) ? result.intent : null, line).toBeNull();
    }
    expect(evalSpy).not.toHaveBeenCalled();
    expect(functionSpy).not.toHaveBeenCalled();
    evalSpy.mockRestore(); functionSpy.mockRestore();
  });

  it('object-prototype words are unknown, not commands or lenses', () => {
    for (const line of ['constructor', '__proto__', 'toString']) expect(parse(line)).toMatchObject({ ok: false, error: expect.stringMatching(/Unknown command/) });
    expect(parse('view constructor')).toMatchObject({ ok: false, error: expect.stringMatching(/view takes one of/) });
    expect(parse('view __proto__')).toMatchObject({ ok: false });
  });

  it('does not export createPanel, so the panel loader ignores it', () => {
    expect('createPanel' in commands).toBe(false);
  });

  it('parsing is pure: the same line gives the same intent and the context is not mutated', () => {
    const fx = setup();
    const ctx = Object.freeze({ snapshot: fx.snapshot(), seed: 101, drafts: Object.freeze(['d1']) });
    const lines = ['fault kill --drone 4', 'inject --draft d1', 'reset', 'help'];
    const first: Intent[] = lines.map(line => { const r = parse(line, ctx); if (!r.ok) throw new Error(r.error); return r.intent; });
    const second: Intent[] = lines.map(line => { const r = parse(line, ctx); if (!r.ok) throw new Error(r.error); return r.intent; });
    expect(second).toEqual(first);
    expect(fx.events).toEqual([]);
  });
});
