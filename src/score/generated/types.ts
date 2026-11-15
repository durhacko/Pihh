// src/score/generated/types.ts
// The scene types (GF-WP-01) now live in the contracts (src/contracts/generatedScene.ts, GF-CC-01). This file
// re-exports them so the generated-scene modules keep their imports unchanged.
export type {
  ColourSpec, Geometry2D, Geometry3D, Material3D, Part3D, SceneSpec, SceneSpec2D, SceneSpec3D, SceneView, Shape2D, Vec2,
} from '../../contracts/generatedScene';
export type { Vec3 } from '../../contracts/params';
