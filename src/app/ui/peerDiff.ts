// Inspector peer diff (P2-WP-09, E05 minimal form): what the selected drone's own state records about each peer, set
// against observer truth about that peer. Raw data only: an id, how long ago the drone last heard that peer (read from
// the drone's own private state) and a truth label. The app never decides "believed alive" or "suspected": that is the
// brain's rule (belief.peersKnown), and restating it here is the re-derivation P2-ADR-07 rejects. So nothing in this
// module compares an age with any parameter.
// ISOLATION: pure, no DOM. Imports nothing from the agent, the world or the observer implementations, and never names
// the world's snapshot type (tests/app/stage/peerDiff.test.ts and isolation.test.ts). No createPanel export.

/** Observer truth about every other drone, by id (built in inspectorTruth.ts). */
export interface PeerTruth {
  liveInRange: number[];      // alive and within rRadio of the selected drone
  liveOutOfRange: number[];   // alive and beyond rRadio
  dead: number[];
}

export type PeerTruthLabel = 'alive, in radio range' | 'alive, out of radio range' | 'dead';

export interface PeerRow {
  id: number;
  /** Ticks since the drone's own state last recorded hearing this peer; null when its peer table has no entry. */
  heardAgo: number | null;
  truth: PeerTruthLabel;
}

interface PeerEntryLike { heard: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The peer table, if `state.peers` is an array whose entries are all null or carry a finite `heard`; otherwise null. */
function peerTable(state: unknown): (PeerEntryLike | null)[] | null {
  if (!isRecord(state) || !Array.isArray(state.peers)) return null;
  for (const entry of state.peers as unknown[]) {
    if (entry === null) continue;
    if (!isRecord(entry) || typeof entry.heard !== 'number' || !Number.isFinite(entry.heard)) return null;
  }
  return state.peers as (PeerEntryLike | null)[];
}

/**
 * One row per peer that observer truth knows about, sorted by id: the age of the drone's own last record of it, and the
 * truth label. Returns null, so the section is hidden, when the state has no well-formed peer table (the static brain
 * has none) or `now` is not finite.
 */
export function peerDiff(state: unknown, truth: PeerTruth, now: number): PeerRow[] | null {
  const peers = peerTable(state);
  if (peers === null || !Number.isFinite(now)) return null;
  const label = new Map<number, PeerTruthLabel>();
  for (const id of truth.liveInRange) label.set(id, 'alive, in radio range');
  for (const id of truth.liveOutOfRange) label.set(id, 'alive, out of radio range');
  for (const id of truth.dead) label.set(id, 'dead');
  const rows: PeerRow[] = [];
  for (const [id, truthLabel] of label) {
    const entry = Number.isInteger(id) && id >= 0 ? peers[id] : undefined;
    rows.push({ id, heardAgo: entry ? now - entry.heard : null, truth: truthLabel });
  }
  return rows.sort((a, b) => a.id - b.id);
}

/** The drone's own tSuspect from its state (state.params.tSuspect), shown only as the section header's reference value. */
export function referenceTSuspect(state: unknown): number | null {
  if (!isRecord(state) || !isRecord(state.params)) return null;
  const value = state.params.tSuspect;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
