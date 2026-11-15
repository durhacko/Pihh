// Test doubles only. They are never wired into src/: the module as shipped has no provider (offline default), and
// no fake output is ever presented as a live Gemini response.
import type { FormationMode, GeminiProvider, ProviderOutcome, ProviderRequest, SceneCheck, SceneSpec, SceneValidator } from '../../src/gemini/types.ts';

export interface FakeProvider extends GeminiProvider {
  readonly calls: ProviderRequest[];
  readonly signals: AbortSignal[];
}

export function fakeProvider(answer: (request: ProviderRequest, signal: AbortSignal) => Promise<ProviderOutcome>): FakeProvider {
  const calls: ProviderRequest[] = [];
  const signals: AbortSignal[] = [];
  return {
    model: 'test-fake-model',
    calls,
    signals,
    generate(request, signal) {
      calls.push(request);
      signals.push(signal);
      return answer(request, signal);
    },
  };
}

export function fakeValidator(check: (candidate: unknown, mode: FormationMode) => SceneCheck): SceneValidator {
  return { validate: check };
}

/** Accepts any object with matching `mode`, returning a fresh copy and a fixed hash. */
export const acceptingValidator = fakeValidator((candidate, mode) => {
  const scene = JSON.parse(JSON.stringify(candidate)) as Record<string, unknown>;
  const accepted = { version: 1, ...scene, mode: (scene.mode ?? mode) as FormationMode } as unknown as SceneSpec;
  return { ok: true, scene: accepted, sceneHash: 'hash-test', trialCompile: 'not-yet-compiled' };
});
