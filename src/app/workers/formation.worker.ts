// src/app/workers/formation.worker.ts
// GF-WP-10 (#265, preview only): compiles a generated scene off the main thread with #259's pure compiler and replies
// with the frozen formation, its digest and warnings, or the typed rejection. It has its own memo and cannot warm the
// main thread's cache (CR-09): it serves the preview only, never a flight. Offline: no network, no provider.
import { compileGeneratedScene } from '../../score/generated';
import type { CompileReply, CompileRequest } from './formationClient';

/** The worker's whole job, as a pure function (tests call it directly). Never throws: the compiler is total. */
export function handleCompileRequest(request: CompileRequest): CompileReply {
  return { requestId: request.requestId, result: compileGeneratedScene(request.scene, request.params, request.n0) };
}

// Registers only inside a worker (a scope with postMessage and no document); importing this module elsewhere is inert.
interface WorkerScope { postMessage(message: CompileReply): void; addEventListener(type: 'message', listener: (event: MessageEvent<CompileRequest>) => void): void }
const scope = (globalThis as unknown as { document?: unknown; postMessage?: unknown; addEventListener?: unknown });
if (typeof scope.postMessage === 'function' && typeof scope.addEventListener === 'function' && scope.document === undefined) {
  const worker = scope as unknown as WorkerScope;
  worker.addEventListener('message', (event) => worker.postMessage(handleCompileRequest(event.data)));
}
