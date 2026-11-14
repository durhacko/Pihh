import { Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import type { Params } from '../../contracts';
import { CameraRig } from './CameraRig';
import type { Layer, LayerFrame } from './Layer';
import { createLayers } from './layers';

export class WorldView {
  readonly scene = new Scene();
  readonly renderer: WebGLRenderer;
  readonly layers: Layer[];
  private resizeObserver: ResizeObserver;

  constructor(private host: HTMLElement, params: Params, readonly rig: CameraRig) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(new URLSearchParams(window.location.search).get('q') === 'low' ? 1 : Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-label', 'Three dimensional drone airspace');
    host.append(this.renderer.domElement);
    this.layers = createLayers();
    for (const layer of this.layers) layer.init({ scene: this.scene, camera: rig.camera, params });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  resize(): void {
    const { width, height } = this.host.getBoundingClientRect();
    this.renderer.setSize(Math.max(width, 1), Math.max(height, 1));
    this.rig.resize(width, height);
  }

  render(frame: LayerFrame): void {
    for (const layer of this.layers) layer.update(frame);
    this.rig.update();
    this.renderer.render(this.scene, this.rig.camera);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    for (const layer of this.layers) layer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
