// tests/app/workers/formationClient.test.ts
// GF-WP-10 (#265): the preview worker's client. One monotonic requestId counter; a reply older than the latest
// request never applies ('stale'); the worker is spawned lazily; a worker failure is a typed rejection, never a throw.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeParams } from '../../../src/contracts';
import type { SceneSpec } from '../../../src/score/generated';
import { createFormationClient, REQUEST_ID, type CompileReply, type CompileRequest, type WorkerLike } from '../../../src/app/workers/formationClient';
import { handleCompileRequest, isWorkerScope, respond } from '../../../src/app/workers/formation.worker';

const scene = (file: string) => JSON.parse(readFileSync(`tests/fixtures/scenes/${file}`, 'utf8')) as SceneSpec;
const params = makeParams(40);

/** A fake worker that records requests and replies only when the test says so, in any order. */
function fakeWorker() {
  const posted: CompileRequest[] = [];
  const listeners: { message: ((e: MessageEvent<CompileReply>) => void)[]; error: ((e: Event) => void)[]; messageerror: ((e: Event) => void)[] } = { message: [], error: [], messageerror: [] };
  let terminated = false;
  const worker: WorkerLike = {
    postMessage: (m) => { posted.push(structuredClone(m)); },
    addEventListener: (type: 'message' | 'error' | 'messageerror', listener: never) => { (listeners[type] as unknown[]).push(listener); },
    terminate: () => { terminated = true; },
  };
  return {
    worker, posted,
    get terminated() { return terminated; },
    reply(request: CompileRequest) { for (const l of listeners.message) l({ data: handleCompileRequest(request) } as MessageEvent<CompileReply>); },
    raw(data: unknown) { for (const l of listeners.message) l({ data } as MessageEvent<CompileReply>); },
    fail(message: string) { for (const l of listeners.error) l({ message, type: 'error' } as unknown as Event); },
    messageError() { for (const l of listeners.messageerror) l({ type: 'messageerror' } as unknown as Event); },
  };
}

describe('the worker job (handleCompileRequest)', () => {
  it('compiles a committed 3D fixture with #259\'s compiler: exactly n0 slots, a digest, and the requestId echoed', () => {
    const reply = handleCompileRequest({ requestId: 'fc:1', scene: scene('valid-3d-sphere.json'), n0: 40, params });
    expect(reply.requestId).toBe('fc:1');
    expect(reply.result.ok).toBe(true);
    if (!reply.result.ok) return;
    expect(reply.result.formation.slots).toHaveLength(40);
    expect(reply.result.slotsDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('an invalid committed scene returns the compiler\'s typed rejection, never a throw', () => {
    const reply = handleCompileRequest({ requestId: 'fc:2', scene: scene('invalid-range-centre.json'), n0: 40, params });
    expect(reply.requestId).toBe('fc:2');
    expect(reply.result.ok).toBe(false);
    if (reply.result.ok) return;
    expect(typeof reply.result.code).toBe('string');
    expect(reply.result.code.length).toBeGreaterThan(0);
  });

  it('a 2D fixture compiles (#212 2D path): exactly n0 slots and a digest', () => {
    const reply = handleCompileRequest({ requestId: 'fc:2d', scene: scene('valid-2d-disc.json'), n0: 40, params });
    expect(reply.result.ok).toBe(true);
    if (!reply.result.ok) return;
    expect(reply.result.formation.slots).toHaveLength(40);
    expect(reply.result.slotsDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('registers only in a dedicated worker scope: never in Node or on a page with a document', () => {
    expect(isWorkerScope(globalThis)).toBe(false);                 // this Node test process
    const fn = () => {};
    expect(isWorkerScope({ postMessage: fn, addEventListener: fn, document: {} })).toBe(false);   // a window
    expect(isWorkerScope({ postMessage: fn, addEventListener: fn })).toBe(true);                    // a worker
    expect(isWorkerScope(null)).toBe(false);
  });

  it('a request whose reply cannot be posted (DataCloneError) answers with ITS OWN internal rejection (#272 review 2)', () => {
    const sent: CompileReply[] = [];
    let first = true;
    respond({ requestId: 'fc:7', scene: scene('valid-3d-sphere.json'), n0: 40, params }, (reply) => {
      if (first) { first = false; throw new Error('DataCloneError'); }
      sent.push(reply);
    });
    expect(sent).toEqual([{ requestId: 'fc:7', result: expect.objectContaining({ ok: false, code: 'internal' }) }]);
    expect((sent[0].result as { detail: string }).detail).toContain('DataCloneError');
  });
});

describe('createFormationClient', () => {
  it('spawns the worker lazily, once, and every requestId matches the spec pattern and increases', async () => {
    let spawned = 0;
    const fake = fakeWorker();
    const client = createFormationClient(() => { spawned++; return fake.worker; });
    expect(spawned).toBe(0);
    expect(client.latest).toBe(null);
    const p1 = client.compile({ scene: scene('valid-3d-sphere.json'), n0: 40, params });
    const p2 = client.compile({ scene: scene('valid-3d-sphere.json'), n0: 40, params });
    expect(spawned).toBe(1);
    expect(fake.posted.map(r => r.requestId)).toEqual(['fc:1', 'fc:2']);
    for (const r of fake.posted) expect(r.requestId).toMatch(REQUEST_ID);
    expect(client.latest).toBe('fc:2');
    expect(await p1).toBe('stale');                  // superseded at once, before any reply
    fake.reply(fake.posted[1]);
    const r2 = await p2;
    expect(r2).not.toBe('stale');
    if (r2 !== 'stale') expect(r2.requestId).toBe('fc:2');
  });

  it('a late reply to an older request never replaces the newer one (out-of-order replies)', async () => {
    const fake = fakeWorker();
    const client = createFormationClient(() => fake.worker);
    const older = client.compile({ scene: scene('valid-3d-sphere.json'), n0: 40, params });
    const newer = client.compile({ scene: scene('valid-3d-two-spheres.json'), n0: 40, params });
    fake.reply(fake.posted[1]);                       // the newer one first
    fake.reply(fake.posted[0]);                       // then the older one, late
    expect(await older).toBe('stale');
    const reply = await newer;
    expect(reply).not.toBe('stale');
    if (reply === 'stale' || !reply.result.ok) throw new Error('expected the newer compile');
    expect(reply.requestId).toBe('fc:2');
    const direct = handleCompileRequest({ requestId: 'x', scene: scene('valid-3d-two-spheres.json'), n0: 40, params });
    expect(direct.result.ok && reply.result.slotsDigest === direct.result.slotsDigest).toBe(true);   // it is the newer scene
  });

  it('ignores unknown or malformed replies; a dead worker is a typed `internal` rejection for every pending request', async () => {
    const fake = fakeWorker();
    const client = createFormationClient(() => fake.worker);
    const pending = client.compile({ scene: scene('valid-3d-sphere.json'), n0: 40, params });
    fake.raw(null);
    fake.raw({ requestId: 'fc:99', result: {} });
    fake.fail('boom');
    const reply = await pending;
    expect(reply).not.toBe('stale');
    if (reply === 'stale') return;
    expect(reply.result).toMatchObject({ ok: false, code: 'internal', detail: 'boom' });
  });

  it('A fails inside the worker, B still gets its good reply: a failure is never charged to another request (#272 review 2)', async () => {
    const fake = fakeWorker();
    const client = createFormationClient(() => fake.worker);
    const a = client.compile({ scene: scene('valid-3d-sphere.json'), n0: 40, params });
    const b = client.compile({ scene: scene('valid-3d-two-spheres.json'), n0: 40, params });
    // The worker answers A with A's own internal rejection (respond() caught it, see the test above), then B normally.
    fake.raw({ requestId: 'fc:1', result: { ok: false, code: 'internal', detail: 'DataCloneError', sceneHash: null, compilerVersion: 0, warnings: [] } });
    fake.reply(fake.posted[1]);
    expect(await a).toBe('stale');
    const rb = await b;
    expect(rb !== 'stale' && rb.requestId === 'fc:2' && rb.result.ok).toBe(true);
  });

  it('after a worker error the worker is terminated and the next compile spawns a fresh one, so nothing hangs (#272 review 3)', async () => {
    const workers: ReturnType<typeof fakeWorker>[] = [];
    const client = createFormationClient(() => { const w = fakeWorker(); workers.push(w); return w.worker; });
    const failed = client.compile({ scene: scene('valid-3d-sphere.json'), n0: 40, params });
    workers[0].fail('chunk failed to load');
    expect(await failed).toMatchObject({ result: { ok: false, code: 'internal' } });
    expect(workers[0].terminated).toBe(true);
    const next = client.compile({ scene: scene('valid-3d-sphere.json'), n0: 40, params });
    expect(workers).toHaveLength(2);                                   // a fresh worker
    expect(workers[0].posted).toHaveLength(1);                         // nothing more went to the dead one
    workers[1].reply(workers[1].posted[0]);
    const reply = await next;
    expect(reply !== 'stale' && reply.result.ok).toBe(true);
    workers[0].reply(workers[0].posted[0]);                            // a late message from the dead worker: ignored
  });

  it('a messageerror is treated like a dead worker: pending fails as internal, the next compile respawns', async () => {
    const workers: ReturnType<typeof fakeWorker>[] = [];
    const client = createFormationClient(() => { const w = fakeWorker(); workers.push(w); return w.worker; });
    const p = client.compile({ scene: scene('valid-3d-sphere.json'), n0: 40, params });
    workers[0].messageError();
    expect(await p).toMatchObject({ result: { ok: false, code: 'internal' } });
    void client.compile({ scene: scene('valid-3d-sphere.json'), n0: 40, params });
    expect(workers).toHaveLength(2);
  });

  it('dispose terminates the worker and settles pending requests as stale; later compiles are stale', async () => {
    const fake = fakeWorker();
    const client = createFormationClient(() => fake.worker);
    const pending = client.compile({ scene: scene('valid-3d-sphere.json'), n0: 40, params });
    client.dispose();
    expect(fake.terminated).toBe(true);
    expect(await pending).toBe('stale');
    expect(await client.compile({ scene: scene('valid-3d-sphere.json'), n0: 40, params })).toBe('stale');
  });
});
