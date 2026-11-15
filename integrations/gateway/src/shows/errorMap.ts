// integrations/gateway/src/shows/errorMap.ts — every failure of the shows routes as the one XI-3 envelope (spec sections
// 10.1–10.6). Codes come from the skeleton's shared list (errors.ts); this module only adds its reasons in
// details[].reason. Messages are fixed text: never driver text, a URI, a stack or a stored value.
import { errorResponse, type ErrorDetail, type ErrorEnvelope } from '../errors.ts';
import type { CompositionIssue } from './validate.ts';

export type ShowsError = { status: number; body: ErrorEnvelope };

const UNAVAILABLE = 'Saved shows are temporarily unavailable.';

/** 400 VALIDATION_FAILED with one detail per issue (path and reason; the rule number stays internal). */
export function validationFailed(issues: readonly Pick<CompositionIssue, 'path' | 'reason'>[]): ShowsError {
  const details: ErrorDetail[] = issues.map(i => ({ path: i.path, reason: i.reason }));
  return errorResponse('VALIDATION_FAILED', 'The request is not a valid saved show.', { details });
}

export function badRequest(reason: 'INVALID_JSON' | 'INVALID_IDEMPOTENCY_KEY' | 'INVALID_ID' | 'INVALID_QUERY' | 'INVALID_CURSOR', path = ''): ShowsError {
  const message = {
    INVALID_JSON: 'The request body is not valid JSON.',
    INVALID_IDEMPOTENCY_KEY: 'The idempotency key is missing or malformed.',
    INVALID_ID: 'The show id is malformed.',
    INVALID_QUERY: 'The query is not valid.',
    INVALID_CURSOR: 'The page cursor is not valid.',
  }[reason];
  return errorResponse('VALIDATION_FAILED', message, { details: [{ path, reason }] });
}

export const payloadTooLarge = (): ShowsError => errorResponse('PAYLOAD_TOO_LARGE', 'The request body is too large.');

/** A newer schemaVersion in a request (400) or a stored document (500, never retried; MDB-T16). */
export const schemaUnsupported = (status: 400 | 500): ShowsError =>
  errorResponse('SCHEMA_VERSION_UNSUPPORTED', 'This saved-show schema version is not supported.', { status, details: [{ path: 'schemaVersion', reason: 'SCHEMA_VERSION_UNSUPPORTED' }] });

export const notFound = (): ShowsError => errorResponse('NOT_FOUND', 'No saved show has that id.');

export const conflict = (): ShowsError =>
  errorResponse('CONFLICT', 'That idempotency key was already used for a different show.', { details: [{ path: '', reason: 'IDEMPOTENCY_CONFLICT' }] });

/** 503: the database is unreachable, the deadline hit, or (POST) the outcome is unknown: retry with the same key. */
export const unavailable = (reason?: 'OUTCOME_UNKNOWN' | 'INDEX_MISSING'): ShowsError =>
  errorResponse('DATABASE_UNAVAILABLE', UNAVAILABLE, reason ? { details: [{ path: '', reason }] } : {});

export const storedShowInvalid = (): ShowsError =>
  errorResponse('INTERNAL', 'The saved show is invalid.', { details: [{ path: '', reason: 'STORED_SHOW_INVALID' }] });

export const internal = (): ShowsError => errorResponse('INTERNAL', 'The show library failed to handle the request.');
