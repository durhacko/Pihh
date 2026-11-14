import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/{contracts,score,agent,sim,observer}/**/*.{ts,tsx,js,mjs}'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'fetch', 'WebSocket', 'XMLHttpRequest', 'Date', 'performance'],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use the seeded RNG.' }],
    },
  },
);
