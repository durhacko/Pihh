import { describe, it, expect } from 'vitest';
import { violations } from '../scripts/check-boundaries.mjs';

describe('core import isolation', () => {
  it('allows contracts, score, and private brain helpers', () => {
    expect(violations("import type { Input } from '../contracts/types'; import './state'; export { x } from '../score/index';", 'src/agent/brain.ts')).toEqual([]);
  });
  it.each([
    "import { world } from '../sim/world';",
    "export { world } from '../sim/world';",
    "const world = import('../sim/world');",
    "const world = require('../sim/world');",
    "import World = require('../sim/world');",
    "type World = import('../sim/world').World;",
    "import * as three from 'three';",
    "import x from '../../outside';",
    "import x from '@/sim/world';",
    'const x = import(path);',
  ])('rejects forbidden brain dependency: %s', source => {
    expect(violations(source, 'src/agent/brain.ts')).toHaveLength(1);
  });
  it('keeps the world independent of brain implementations', () => {
    expect(violations("import { brain } from '../agent/brain';", 'src/sim/world.ts')).toHaveLength(1);
  });
  it('allows the app to assemble components', () => {
    expect(violations("import * as three from 'three';", 'src/app/main.ts')).toEqual([]);
  });
});
