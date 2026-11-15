// src/telemetry/manifest.ts
// The offline import manifest, `manifestVersion` 1 (RFC §5; TD-3). Pure: building and comparing only. Writing it
// (once, atomically, before any connection, under the gateway's state folder) is the gateway importer's job.
// The manifest is keyed by `artifactHash`, so it describes the record, not a file: identity fields are compared on
// re-import, first-observation fields are recorded once and never compared.
import type { RunIdentity } from './identity';
import type { FileForm, SourceKind } from './validate';

export const MANIFEST_VERSION = 1 as const;

export interface ImportManifestV1 {
  manifestVersion: typeof MANIFEST_VERSION;
  hashVersion: RunIdentity['hashVersion'];
  validatorVersion: string;
  // first observation (never compared)
  artifactPath: string;
  fileSha256: string;
  fileBytes: number;
  fileForm: FileForm;
  // identity (compared on re-import)
  artifactHash: string;
  experimentKey: string;
  pairKey: string | null;
  runId: string;
  gitClean: boolean;
  compositionId: string | null;
  sourceKind: SourceKind;
  dtSeconds: number;
  expectedSamples: number;
  eventCount: number;
  seriesDigest: string;
  eventsDigest: string;
  summaryDigest: string;
  // first observation (never compared); wall clock is allowed here, never in a RunRecord
  createdAt: string;
}

/** Fields that are functions of the parsed record (RFC §5). */
export const IDENTITY_FIELDS = [
  'hashVersion', 'artifactHash', 'experimentKey', 'pairKey', 'runId', 'gitClean', 'compositionId', 'sourceKind',
  'dtSeconds', 'expectedSamples', 'eventCount', 'seriesDigest', 'eventsDigest', 'summaryDigest',
] as const satisfies readonly (keyof ImportManifestV1)[];

/** Fields describing the file the manifest was first written from (RFC §5): recorded once, never compared. */
export const FIRST_OBSERVATION_FIELDS = ['artifactPath', 'fileSha256', 'fileBytes', 'fileForm', 'createdAt'] as const satisfies readonly (keyof ImportManifestV1)[];

/** POSIX, repo-relative, no `..` segment (RFC §5; the same rule is a CHECK in §6.1 and §6.5). */
const ARTIFACT_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const DOT_DOT = /(^|\/)\.\.(\/|$)/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
/** An ISO-8601 UTC instant as the caller passes it, e.g. 2026-11-15T03:00:00.000Z. Treated as an opaque string. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

/** Normalises separators to `/` and checks the label rule. Returns null if the path is refused (absolute, `~/`,
 *  UNC, drive letter, `..`, or any other character). */
export function normaliseArtifactPath(path: string): string | null {
  const posix = path.replace(/\\/g, '/');
  return ARTIFACT_PATH.test(posix) && !DOT_DOT.test(posix) ? posix : null;
}

export interface ManifestInit {
  artifactPath: string;
  /** The gateway's UUIDv5(ENCORE_TIGER_NS_V1, artifactHash) (TIG-D4). */
  runId: string;
  sourceKind: SourceKind;
  validatorVersion: string;
  fileForm: FileForm;
  /** DT at the record's git, established by the importer (RFC §8, TCR-15); not read from this checkout. */
  dtSeconds: number;
  /** Passed in by the caller; this module reads no clock. */
  createdAt: string;
}

export function buildManifest(id: RunIdentity, init: ManifestInit): ImportManifestV1 {
  const artifactPath = normaliseArtifactPath(init.artifactPath);
  if (artifactPath === null) throw new Error('buildManifest: artifactPath must be a POSIX repo-relative path without ..');
  if (!UUID.test(init.runId)) throw new Error('buildManifest: runId must be a lower-case UUID');
  if (!SEMVER.test(init.validatorVersion)) throw new Error('buildManifest: validatorVersion must be x.y.z');
  if (!INSTANT.test(init.createdAt)) throw new Error('buildManifest: createdAt must be an ISO-8601 UTC instant');
  if (!(Number.isFinite(init.dtSeconds) && init.dtSeconds > 0)) throw new Error('buildManifest: dtSeconds must be finite and > 0');
  return {
    manifestVersion: MANIFEST_VERSION,
    hashVersion: id.hashVersion,
    validatorVersion: init.validatorVersion,
    artifactPath,
    fileSha256: id.fileSha256,
    fileBytes: id.fileBytes,
    fileForm: init.fileForm,
    artifactHash: id.artifactHash,
    experimentKey: id.experimentKey,
    pairKey: id.pairKey,
    runId: init.runId,
    gitClean: id.gitClean,
    compositionId: id.compositionId,
    sourceKind: init.sourceKind,
    dtSeconds: init.dtSeconds,
    expectedSamples: id.expectedSamples,
    eventCount: id.eventCount,
    seriesDigest: id.seriesDigest,
    eventsDigest: id.eventsDigest,
    summaryDigest: id.summaryDigest,
    createdAt: init.createdAt,
  };
}

/** RFC §5 immutability: the identity fields that differ between an existing manifest and a recomputed one. Empty
 *  means the manifest is reused, whatever the file's bytes, form or location; non-empty is `MANIFEST_MISMATCH`. */
export function manifestMismatches(existing: ImportManifestV1, incoming: ImportManifestV1): (typeof IDENTITY_FIELDS)[number][] {
  return IDENTITY_FIELDS.filter(field => existing[field] !== incoming[field]);
}

/** Relative file name of a manifest inside the state folder (RFC §5). A `validatorVersion` change may add a second
 *  manifest beside the first under the versioned name; nothing is ever overwritten. */
export function manifestFileName(artifactHash: string, validatorVersion?: string): string {
  if (!/^[0-9a-f]{64}$/.test(artifactHash)) throw new Error('manifestFileName: artifactHash must be 64 hex');
  if (validatorVersion === undefined) return `manifests/${artifactHash}.manifest.json`;
  if (!SEMVER.test(validatorVersion)) throw new Error('manifestFileName: validatorVersion must be x.y.z');
  return `manifests/${artifactHash}.v${validatorVersion}.manifest.json`;
}
