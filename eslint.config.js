import tseslint from 'typescript-eslint';
import js from '@eslint/js';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'research/**'] },
  { ...js.configs.recommended, files: ['src/**/*.ts', 'tests/**/*.ts'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/{contracts,score,agent,sim,observer}/**/*.{ts,tsx,js,mjs}'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'fetch', 'WebSocket', 'XMLHttpRequest', 'Date', 'performance',
        'crypto', 'self', 'globalThis'],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use the seeded RNG.' }],
    },
  },
  {
    files: ['src/telemetry/**/*.{ts,tsx,js,mjs}'],
    rules: {
      'no-restricted-globals': ['error', 'fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'Date', 'performance', 'window', 'self', 'navigator'],
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'src/telemetry is pure: no randomness.' },
        { object: 'globalThis', property: 'fetch', message: 'src/telemetry makes no network call.' },
        { object: 'globalThis', property: 'WebSocket', message: 'src/telemetry makes no network call.' },
        { object: 'globalThis', property: 'XMLHttpRequest', message: 'src/telemetry makes no network call.' },
        { object: 'globalThis', property: 'EventSource', message: 'src/telemetry makes no network call.' },
        { object: 'globalThis', property: 'navigator', message: 'src/telemetry makes no network call (sendBeacon).' },
        { object: 'globalThis', property: 'self', message: 'src/telemetry is pure: no host globals.' },
        { object: 'globalThis', property: 'window', message: 'src/telemetry is pure: no host globals.' },
      ],
    },
  },
  {
    // GF-WP-06, spec §7.12: the generated-scene compiler forbids Math.hypot (implementation-approximated; use the square
    // root of a sum of squares). Later options replace earlier ones, so Math.random is repeated. validation.ts (GF-WP-01)
    // still uses Math.hypot and is left to its owner as a follow-up.
    files: ['src/score/generated/**/*.{ts,tsx,js,mjs}'],
    ignores: ['src/score/generated/validation.ts'],
    rules: {
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG.' },
        { object: 'Math', property: 'hypot', message: 'Spec §7.12: use Math.sqrt of a sum of squares.' }],
    },
  },
);
