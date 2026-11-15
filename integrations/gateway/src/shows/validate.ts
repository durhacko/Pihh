// integrations/gateway/src/shows/validate.ts — the shows module's ONE bridge into the app's src/ (XI-2, XI-13, XI-19).
// It re-exports the pure composition validator (src/app/compose/validate.ts, MDB-WP-02) and the one canonical-JSON rule
// (src/score/canonical.ts) by relative path, plus makeParams from src/contracts, and computes the two server-side
// hashes with node:crypto (spec section 7.3, XI-7). No copy of any rule lives in the gateway: every other shows file
// imports these names from here, and test/shows/imports.test.ts checks that only this file leaves the gateway.
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../../src/score/canonical.ts';
import type { SavedShowComposition, ShowRequest } from '../../../../src/app/compose/validate.ts';

export {
  COMPOSITION_LIMITS, GENERATOR_LIMITS, SUPPORTED_SCHEMA_VERSION, TEXT_MAX, compositionPreview, validateComposition,
  validateShowRequest, validateText,
} from '../../../../src/app/compose/validate.ts';
export type {
  CompositionCheck, CompositionIssue, CompositionOptions, CompositionReason, Generator, SavedShowComposition,
  SavedShowMovement, ShowRequest, ShowRequestCheck, ShowSource,
} from '../../../../src/app/compose/validate.ts';
export { makeParams } from '../../../../src/contracts/params.ts';
export type { Params } from '../../../../src/contracts/params.ts';
export { canonicalJson };

/**
 * The app's roster sizes (src/app/main.ts ROSTERS: 100, 150, 200), restated because the gateway may not import
 * src/app/main.ts. The gateway does not know which one the app runs, so R14's trial expansion runs at the smallest
 * and the largest (spec section 9, MDB-T08); test/shows/validate.test.ts pins these to main.ts.
 */
export const APP_N0_RANGE: Readonly<{ smallest: number; largest: number }> = Object.freeze({ smallest: 100, largest: 200 });

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** contentHash = hex SHA-256 of UTF-8 canonicalJson(composition) (spec section 7.3, XI-7). Server-computed only. */
export function contentHash(composition: SavedShowComposition): string {
  return sha256(canonicalJson(composition));
}

/**
 * requestHash = hex SHA-256 of canonicalJson({ schemaVersion, title, prompt?, composition, source, generator? }) of the
 * VALIDATED, normalised request (spec section 7.3): the idempotency fingerprint. Built field by field, so nothing else
 * (operationId, timestamps, stray keys) can enter it; absent optional fields are omitted.
 */
export function requestHash(request: ShowRequest): string {
  return sha256(canonicalJson({
    schemaVersion: request.schemaVersion,
    title: request.title,
    ...(request.prompt !== undefined ? { prompt: request.prompt } : {}),
    composition: request.composition,
    source: request.source,
    ...(request.generator !== undefined ? { generator: request.generator } : {}),
  }));
}
