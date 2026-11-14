import type { Camera, Scene } from 'three';
import type { Formation, Params, WorldSnapshot } from '../../contracts';
import type { SnapshotFrame } from './SnapshotBuffer';

export interface LayerFrame extends SnapshotFrame {
  slots?: { formation: Formation; inHold: boolean; status: ('occupied' | 'inTransit' | 'vacant' | 'contested')[] };
}
export interface Layer {
  id: string;
  init(ctx: { scene: Scene; camera: Camera; params: Params }): void;
  update(frame: LayerFrame): void;
  /** Optional: called once for EVERY simulation tick of this view's world, in order, independent of render
   *  frames (#46). A frame that advances several ticks still delivers each tick's snapshot here first. */
  ingest?(snapshot: WorldSnapshot): void;
  /** Optional: the world was rebuilt (reset); drop every retained piece of evidence. */
  reset?(): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}
export type LayerFactory = () => Layer;
