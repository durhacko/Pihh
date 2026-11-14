import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type CameraPreset = 'audience' | 'quarter' | 'top';
const presets: Record<CameraPreset, [number, number, number]> = {
  audience: [0, 6, 95], quarter: [55, 45, 75], top: [0, 140, 0.1],
};

/** One camera can be shared by multiple WorldViews for aligned comparisons. */
export class CameraRig {
  readonly camera = new PerspectiveCamera(50, 1, 0.1, 1000);
  private controls: OrbitControls | null = null;
  private target = new Vector3(0, 30, 0);

  constructor() { this.preset('audience'); }

  attach(element: HTMLElement): void {
    this.controls?.dispose();
    this.controls = new OrbitControls(this.camera, element);
    this.controls.target.copy(this.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 250;
    this.controls.maxPolarAngle = Math.PI * 0.95;
    this.controls.update();
  }

  preset(name: CameraPreset): void {
    this.camera.position.set(...presets[name]);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    this.controls?.target.copy(this.target);
    this.controls?.update();
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  update(): void { this.controls?.update(); }
  dispose(): void { this.controls?.dispose(); this.controls = null; }
}
