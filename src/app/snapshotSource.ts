import type { Params, WorldSnapshot } from '../contracts';
import { makeFakeSnapshot } from '../../tests/fixtures/fakeSnapshot';

export interface SnapshotSource { initial: WorldSnapshot; step(): WorldSnapshot }

/** WP-3b replaces only this source with real, lockstep worlds. This is a fixture preview. */
export function createSnapshotSource(params: Params): SnapshotSource {
  let tick = 0;
  return { initial: makeFakeSnapshot(0, params.n0), step: () => makeFakeSnapshot(++tick, params.n0) };
}
