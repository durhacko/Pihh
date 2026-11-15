import tseslint from 'typescript-eslint';
import js from '@eslint/js';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'research/**'] },
  { ...js.configs.recommended, files: ['src/**/*.ts', 'tests/**/*.ts'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/{contracts,score,agent,sim,observer}/**/*.{ts,tsx,js,mjs}'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'fetch', 'WebSocket', 'XMLHttpRequest', 'Date', 'performance'],
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
);
