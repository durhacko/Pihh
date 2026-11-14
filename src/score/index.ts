// src/score/index.ts
// Public API of the score package (contract section 6). Pure TypeScript: no DOM, no clock, no randomness.
export { expandRecipe } from './expand';
export { currentMovement, newerVersion, transitionTicksBetween } from './timing';
export { composeNext, launchPos, makeScore } from './compose';
