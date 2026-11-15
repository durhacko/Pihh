// src/score/index.ts
// Public API of the score package (contract section 6). Pure TypeScript: no DOM, no clock, no randomness.
export { expandRecipe, expandRecipeStrict, GeneratedSceneRejected, isFallbackFormation } from './expand';
export { currentMovement, newerVersion, transitionTicksBetween } from './timing';
export { acceptsRecipe, composeNext, copyRecipe, launchPos, makeGeneratedRecipe, makeScore, sceneHashOf } from './compose';
