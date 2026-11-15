// src/telemetry/index.ts
// Pure, offline telemetry core for the Tiger Data integration (TIG-02, #231; RFC TIGER_TELEMETRY_AND_INGESTION).
// Imports only src/contracts, src/score/canonical.ts and src/score/font.ts. No network, clock, randomness or node:*.
export * from './validate';
export * from './digest';
export * from './identity';
export * from './normalise';
export * from './manifest';
export * from './ledger';
