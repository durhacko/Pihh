// src/app/workers/formation.worker.ts
// GF-WP-10 (#265, preview only): compiles a generated scene off the main thread with #259's pure compiler and replies
// with the frozen formation, its digest and warnings, or the typed rejection. It has its own memo and cannot warm the
// main thread's cache (CR-09): it serves the preview only, never a flight. Offline: no network, no provider.
import { compileGeneratedScene } from '../../score/generated';
import { workerFailure, type CompileReply, type CompileRequest } from './formationClient';

/** The worker's whole job, as a pure function (tests call it directly). Never throws: the compiler is total. */
export function handleCompileRequest(request: CompileRequest): CompileReply {
  return { requestId: request.requestId, result: compileGeneratedScene(request.scene, request.params, request.n0) };
}

/**
 * Answers ONE request, always under its own requestId: if compiling or posting the reply fails (a DataCloneError,
 * out of memory), it posts that request's `internal` rejection instead, so a failure is never charged to another
 * request and never surfaces as a worker-level error (#272 review).
 */
export function respond(request: CompileRequest, post: (reply: CompileReply) => void): void {
  const requestId = typeof request?.requestId === 'string' ? request.requestId : '';
  try {
    post(handleCompileRequest(request));
  } catch (error) {
    post({ requestId, result: workerFailure(`the preview compile failed: ${String(error)}`) });
  }
}

/** True only in a dedicated worker scope (postMessage and addEventListener, no document). */
export function isWorkerScope(scope: unknown): boolean {
  const s = scope as { document?: unknown; postMessage?: unknown; addEventListener?: unknown } | null;
  return !!s && typeof s.postMessage === 'function' && typeof s.addEventListener === 'function' && s.document === undefined;
}

// Registers only inside a worker; importing this module elsewhere (main thread, Node tests) is inert.
interface WorkerScope { postMessage(message: CompileReply): void; addEventListener(type: 'message', listener: (event: MessageEvent<CompileRequest>) => void): void }
if (isWorkerScope(globalThis)) {
  const worker = globalThis as unknown as WorkerScope;
  worker.addEventListener('message', (event) => respond(event.data, (reply) => worker.postMessage(reply)));
}
