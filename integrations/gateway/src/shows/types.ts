// integrations/gateway/src/shows/types.ts — the shows module's data types (MDB-WP-03 "Proposed interfaces"; canonical
// spec docs/integrations/mongodb-atlas-show-library.md sections 7.1, 10.1). Types, plus one constant (the fixed title).
//
// OFFLINE BUILD: there is no driver here, so an id is its 24 lower-case hex string (`ShowId`). The MongoDB repository
// (later, under D3) maps it to and from ObjectId at its own edge; nothing above the repository sees a driver type.
// The stored document is a reusable composition and its metadata only: never a runtime ScoreVersion, absolute tick,
// drone id, slot, position, telemetry, frame, snapshot, run record, replay or wall-clock latency (spec section 7.1,
// MD-13, XI-6). test/shows/repository.test.ts scans this file for such fields.
import type { Generator, SavedShowComposition, ShowSource } from './validate.ts';

/** A saved show's id: 24 lower-case hex (an ObjectId's hex form). Callers check `^[0-9a-f]{24}$` before any lookup. */
export type ShowId = string;

/** The listing summary a composition gives (spec section 7.1 `preview`). */
export interface ShowPreview { movementCount: number; kinds: string[] }

/** One document of `encore.saved_shows` (spec section 7.1). Built field by field from a validated request, never spread. */
export interface SavedShowDoc {
  _id: ShowId;
  schemaVersion: 1;
  title: string;
  prompt?: string;                       // only with the explicit "Store prompt" opt-in (MDB-D2)
  composition: SavedShowComposition;
  contentHash: string;                   // sha256(canonicalJson(composition)), server-computed (XI-7)
  requestHash: string;                   // the idempotency fingerprint of the normalised request (section 7.3)
  source: ShowSource;
  generator?: Generator;                 // iff source is 'gemini'
  preview: ShowPreview;
  operationId: string;                   // lower-case UUID v4, unique (section 10.5)
  createdAt: Date;
  updatedAt: Date;                       // equal to createdAt in the MVP
}

/** What a save hands the repository: the repository adds `_id`, `schemaVersion` and the timestamps. */
export type NewSavedShow = Omit<SavedShowDoc, '_id' | 'schemaVersion' | 'createdAt' | 'updatedAt'>;

/** The result of an insert (section 10.5). The caller compares `requestHash` to tell a replay (200) from a conflict (409). */
export type InsertOutcome =
  | { kind: 'created'; id: ShowId }
  | { kind: 'duplicate'; id: ShowId; requestHash: string }   // operationId already stored: the stored document's id and requestHash
  | { kind: 'outcome-unknown' };                             // duplicate key, then the stored document could not be read: 503 OUTCOME_UNKNOWN

/** Keyset position: the last item of a page, in the total order (createdAt desc, _id desc) (spec section 11). */
export interface PageKey { createdAt: Date; id: ShowId }

/** A listing item (spec section 10.1 ShowSummary): metadata only, never `composition` or `prompt`. */
export interface LoadableShowSummary {
  id: ShowId; title: string; source: ShowSource; createdAt: string;   // ISO 8601
  movementCount: number; kinds: string[]; schemaVersion: number;
  loadable: true;
}
/** A stored document that is newer than this reader: its metadata is valid and shown, but it is never loaded (section 7.4). */
export interface UnsupportedShowSummary extends Omit<LoadableShowSummary, 'loadable'> {
  loadable: false; problem: 'unsupported-schema';
}
/**
 * A stored document whose projected fields fail the per-item check (section 10.3): shown with the fixed title and NO
 * stored value (it may have been written outside this service). Only its id, which the query already re-typed, is kept.
 */
export interface InvalidShowSummary { id: ShowId; title: typeof INVALID_SHOW_TITLE; loadable: false; problem: 'invalid' }
export type ShowSummary = LoadableShowSummary | UnsupportedShowSummary | InvalidShowSummary;

/** The fixed title of an invalid listing item (section 10.3). */
export const INVALID_SHOW_TITLE = 'Invalid saved show';

/** A retrieved show (section 10.1 SavedShow), after the read-side validation in repository.ts. */
export interface SavedShow extends LoadableShowSummary {
  prompt?: string; composition: SavedShowComposition; contentHash: string; generator?: Generator; updatedAt: string;
}

/** This module's entry in GET /api/health (section 10.4). Never a URI, host, user, error text or reason. */
export type ShowsHealth = { enabled: boolean; db: 'up' | 'down' | 'disabled'; writable: boolean };   // a type, so it fits ModuleHealth's index signature
