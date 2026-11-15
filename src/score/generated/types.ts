// Scene types for Gemini-generated formations (GF-WP-01), exactly the canonical spec
// docs/integrations/gemini-generated-formations.md §6.2–§6.3. They live here, not in
// src/contracts, until GF-CC-01 / GF-WP-07 is approved. Nothing imports them yet.
//
// Coordinates (§6.1): normalised space, x to the audience's right, y up, z towards the
// audience (right-handed). Centres and curve points lie in [-1.5, 1.5]; a part's evaluated
// geometry may reach ±1.6. 2D scenes lie in z = 0 and face +z. The subject faces +z and is
// left/right symmetric about x = 0. Angles are degrees: rotationDeg [rx, ry, rz] means
// R = Rz · Ry · Rx about the part's centre (X first, then Y, then Z, on fixed axes).

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** sRGB-encoded colour: '#RRGGBB' (case-insensitive), or [r, g, b] with each in 0..1. */
export type ColourSpec = string | [number, number, number];

/** Camera presets, not subject poses (§6.1). */
export type SceneView = 'front' | 'side' | 'three-quarter';

export interface SceneSpec2D {
  version: 1;
  mode: 'silhouette2d';
  /** 1..60 printable characters; display only, never interpreted. */
  title: string;
  view: SceneView;
  foreground: ColourSpec;
  /** Applied in array order. */
  parts: Shape2D[];
}

export interface Shape2D {
  /** /^[a-z][a-z0-9_-]{0,31}$/, unique in the scene. */
  id: string;
  operation: 'union' | 'subtract';
  geometry: Geometry2D;
  /** Integer 1..5; 5 = most important; >= 4 is "protected". */
  priority: number;
}

export type Geometry2D =
  | { type: 'ellipse'; center: Vec2; radii: Vec2; rotationDeg?: number }
  /** 3..64 vertices, simple, implicitly closed. */
  | { type: 'polygon'; points: Vec2[] }
  /** Closed cubic Bézier chain: 3k+1 points, k = 1..32. */
  | { type: 'path'; points: Vec2[] }
  /** Open cubic Bézier chain: 3k+1 points, k = 1..8; `width` is the full width. */
  | { type: 'stroke'; points: Vec2[]; width: number };

export interface SceneSpec3D {
  version: 1;
  mode: 'scene3d';
  title: string;
  referenceView: SceneView;
  materials: Material3D[];
  /** 1..32 before mirroring; 1..48 after. */
  parts: Part3D[];
}

export interface Material3D {
  id: string;
  /** sRGB-encoded, each in 0..1. */
  rgb: [number, number, number];
}

export interface Part3D {
  id: string;
  shape: Geometry3D;
  /** Must name a declared material. */
  materialId: string;
  /** Integer 1..5; >= 4 is "protected". */
  importance: number;
  /** mirror-x adds a copy reflected in the plane x = 0, with id suffix `~m`. */
  symmetry?: 'none' | 'mirror-x';
}

export type Geometry3D =
  | { type: 'ellipsoid'; center: Vec3; radii: Vec3; rotationDeg?: Vec3 }
  /** Axis along local +y; `length` is the straight section between the hemisphere centres. */
  | { type: 'capsule'; center: Vec3; radius: number; length: number; rotationDeg?: Vec3 }
  /** Capped, axis along local +y. */
  | { type: 'cylinder'; center: Vec3; radius: number; height: number; rotationDeg?: Vec3 }
  /** Capped frustum, axis along local +y, base at -height/2; topRadius 0 = a pointed cone. */
  | { type: 'cone'; center: Vec3; baseRadius: number; topRadius: number; height: number; rotationDeg?: Vec3 }
  /** Cubic Bézier centreline, 3k+1 points, k = 1..5, in scene coordinates (no rotation). */
  | { type: 'taperedTube'; points: Vec3[]; startRadius: number; endRadius: number };

export type SceneSpec = SceneSpec2D | SceneSpec3D;
