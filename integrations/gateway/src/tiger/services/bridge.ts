// integrations/gateway/src/tiger/services/bridge.ts
// The one place the tiger read routes import the repo's pure src/ code (XI-2): DT from the contracts and the
// ingestion row types from src/telemetry. Every other routes/services file imports from here, so the skeleton's
// import allow-list (test/offline.test.ts BRIDGES) needs this single entry for them.
export { DT } from '../../../../../src/contracts/params.ts';
export type { MetricRow, RunRow, RunRows } from '../../../../../src/telemetry/index.ts';
