import type { Camera, Scene } from 'three';
import type { Formation, Params } from '../../contracts';
import type { SnapshotFrame } from './SnapshotBuffer';

export interface LayerFrame extends SnapshotFrame {
  slots?: { formation: Formation; inHold: boolean; status: ('occupied' | 'inTransit' | 'vacant' | 'contested')[] };
}
export interface Layer {
  id: string;
  init(ctx: { scene: Scene; camera: Camera; params: Params }): void;
  update(frame: LayerFrame): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}
export type LayerFactory = () => Layer;
