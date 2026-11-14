import tseslint from 'typescript-eslint';
import js from '@eslint/js';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  { ...js.configs.recommended, files: ['src/**/*.ts', 'tests/**/*.ts'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/{contracts,score,agent,sim,observer}/**/*.{ts,tsx,js,mjs}'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'fetch', 'WebSocket', 'XMLHttpRequest', 'Date', 'performance'],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use the seeded RNG.' }],
    },
  },
);
