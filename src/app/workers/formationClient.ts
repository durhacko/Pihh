// src/app/workers/formationClient.ts
// GF-WP-10 (#265, preview only): the main-thread side of the preview compile worker. Every request carries a
// requestId from ONE monotonic client counter (spec §10.1); a reply older than the latest request is dropped, so a
// late compile can never overwrite a newer preview (William's "late response can overwrite newer prompt" risk).
// Offline: the worker runs the pure compiler of #259 (src/score/generated). Nothing here sends anything anywhere.
// Type-only imports: the compiler itself is bundled into the worker, not into this module.
import type { CompileParams, CompileResult, SceneSpec } from '../../score/generated';

/** Spec §10.1 / boundaries §6.2: optional, client-generated, opaque, `^[A-Za-z0-9._:-]{1,64}$`. */
export const REQUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/;

export interface CompileRequest { requestId: string; scene: SceneSpec; n0: number; params: CompileParams }
export interface CompileReply { requestId: string; result: CompileResult }

/** The part of a Worker the client uses (a real `Worker`, or a fake in tests). */
export interface WorkerLike {
  postMessage(message: CompileRequest): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<CompileReply>) => void): void;
  addEventListener(type: 'error', listener: (event: Event) => void): void;
  terminate(): void;
}

export interface FormationClient {
  /** Resolves with the reply, or 'stale' if a newer request was made before it arrived (or the client was disposed). */
  compile(request: Omit<CompileRequest, 'requestId'>): Promise<CompileReply | 'stale'>;
  /** The id of the newest request, or null before the first. */
  readonly latest: string | null;
  dispose(): void;
}

/** A typed rejection for a worker that failed before replying (it never throws to the caller). */
function workerFailure(detail: string): CompileResult {
  return { ok: false, code: 'internal', detail, sceneHash: null, compilerVersion: 0, warnings: [] };
}

/**
 * The worker is spawned lazily on the first compile, so a page that never opens the generated tab never starts it.
 * Replies are matched by requestId; anything that is not the latest request resolves 'stale' and is never applied.
 */
export function createFormationClient(spawn: () => WorkerLike): FormationClient {
  let worker: WorkerLike | null = null;
  let counter = 0;
  let latest: string | null = null;
  let disposed = false;
  const pending = new Map<string, (reply: CompileReply | 'stale') => void>();

  const settle = (id: string, value: CompileReply | 'stale') => {
    const resolve = pending.get(id);
    if (!resolve) return;
    pending.delete(id);
    resolve(value);
  };
  const ensure = (): WorkerLike => {
    if (worker) return worker;
    const w = spawn();
    w.addEventListener('message', (event: MessageEvent<CompileReply>) => {
      const reply = event.data;
      if (!reply || typeof reply.requestId !== 'string' || !pending.has(reply.requestId)) return;   // unknown or stale
      settle(reply.requestId, reply.requestId === latest ? reply : 'stale');
    });
    w.addEventListener('error', (event: Event) => {
      const message = (event as ErrorEvent).message || 'the preview worker failed';
      if (latest) settle(latest, { requestId: latest, result: workerFailure(message) });
    });
    worker = w;
    return w;
  };

  return {
    get latest() { return latest; },
    compile(request) {
      if (disposed) return Promise.resolve('stale');
      const requestId = `fc:${++counter}`;
      // Every older request is superseded now: it resolves 'stale' at once and its reply, if it comes, is ignored.
      for (const id of [...pending.keys()]) settle(id, 'stale');
      latest = requestId;
      const promise = new Promise<CompileReply | 'stale'>((resolve) => pending.set(requestId, resolve));
      ensure().postMessage({ requestId, scene: request.scene, n0: request.n0, params: request.params });
      return promise;
    },
    dispose() {
      disposed = true;
      for (const id of [...pending.keys()]) settle(id, 'stale');
      worker?.terminate();
      worker = null;
    },
  };
}

/** The app's worker: a module worker from formation.worker.ts (Vite bundles it separately). */
export function spawnFormationWorker(): WorkerLike {
  return new Worker(new URL('./formation.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}
