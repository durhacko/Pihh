// integrations/gateway/src/gemini/request.ts
// Request validation for `POST /api/generate-formation` (gemini spec §10.1, §10.2 "Request validation"). Pure.
// The Content-Type, Host, Origin and token checks are the shared guard's (boundaries §6.2), not this file's.
import { acceptRequestId, errorResponse, type ErrorEnvelope } from '../errors.ts';
import { FORMATION_MODES, GEMINI_LIMITS, type FormationMode, type GenerateFormationRequest } from './types.ts';

export type ParsedRequest =
  | { ok: true; request: GenerateFormationRequest }
  | { ok: false; status: number; body: ErrorEnvelope };

const ALLOWED_KEYS = new Set(['prompt', 'mode', 'requestId']);
// Not printable: controls, lone surrogates, private use, line/paragraph separators, the BOM, and the invisible
// zero-width and bidi-control characters (U+200B, U+200E-U+200F, U+202A-U+202E, U+2060-U+2064, U+2066-U+2069),
// which can hide or reorder prompt text. ZWJ (U+200D) and ZWNJ (U+200C) stay: emoji sequences and several scripts
// need them.
const NOT_PRINTABLE = /[\p{Cc}\p{Cs}\p{Co}\p{Zl}\p{Zp}​‎‏‪-‮⁠-⁤⁦-⁩﻿]/u;

function fail(code: 'VALIDATION_FAILED' | 'PAYLOAD_TOO_LARGE', message: string, path: string, reason: string, requestId?: string): ParsedRequest {
  return { ok: false, ...errorResponse(code, message, { details: [{ path, reason }], requestId }) };
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Parses and validates a raw request body. Unknown fields, a bad mode and a bad prompt are 400
 *  `VALIDATION_FAILED`; a body over 8 KiB is 413 `PAYLOAD_TOO_LARGE`. A bad `requestId` is dropped, not an error. */
export function parseGenerateRequest(rawBody: string): ParsedRequest {
  if (utf8Bytes(rawBody) > GEMINI_LIMITS.requestBodyMaxBytes) {
    return fail('PAYLOAD_TOO_LARGE', 'The request body is too large.', '', 'REQUEST_TOO_LARGE');
  }
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    return fail('VALIDATION_FAILED', 'The request body is not valid JSON.', '', 'BAD_REQUEST');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('VALIDATION_FAILED', 'The request body must be a JSON object.', '', 'BAD_REQUEST');
  }
  const body = value as Record<string, unknown>;
  const requestId = Object.hasOwn(body, 'requestId') ? acceptRequestId(body.requestId) : undefined;

  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) {
      return fail('VALIDATION_FAILED', 'The request has a field that is not accepted.', `/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, 'BAD_REQUEST', requestId);
    }
  }

  const mode = body.mode;
  if (typeof mode !== 'string' || !(FORMATION_MODES as readonly string[]).includes(mode)) {
    return fail('VALIDATION_FAILED', 'mode must be "silhouette2d" or "scene3d".', '/mode', 'BAD_REQUEST', requestId);
  }

  if (typeof body.prompt !== 'string') {
    return fail('VALIDATION_FAILED', 'prompt must be a string.', '/prompt', 'BAD_REQUEST', requestId);
  }
  const prompt = body.prompt.trim();
  if (prompt.length === 0) {
    return fail('VALIDATION_FAILED', 'prompt is empty.', '/prompt', 'BAD_REQUEST', requestId);
  }
  if (NOT_PRINTABLE.test(prompt)) {
    return fail('VALIDATION_FAILED', 'prompt has characters that are not printable.', '/prompt', 'BAD_REQUEST', requestId);
  }
  if ([...prompt].length > GEMINI_LIMITS.promptMax) {
    return fail('VALIDATION_FAILED', `prompt is longer than ${GEMINI_LIMITS.promptMax} characters.`, '/prompt', 'PROMPT_TOO_LONG', requestId);
  }

  const request: GenerateFormationRequest = { prompt, mode: mode as FormationMode };
  if (requestId !== undefined) request.requestId = requestId;
  return { ok: true, request };
}
