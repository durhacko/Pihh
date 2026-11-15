import { Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import type { Params, WorldSnapshot } from '../../contracts';
import { CameraRig } from './CameraRig';
import type { Layer, LayerFrame } from './Layer';
import { createLayers } from './layers';
import { sharedQuality, type QualityController } from './quality';

/** Quality level from which the static view of a split renders every other frame (render/quality.ts). */
const HALF_RATE_LEVEL = 4;
/** Quality level from which the pixel ratio is 1 instead of min(devicePixelRatio, 1.5). */
const PIXEL_RATIO_ONE_LEVEL = 3;

export class WorldView {
  readonly scene = new Scene();
  readonly renderer: WebGLRenderer;
  readonly layers: Layer[];
  private resizeObserver: ResizeObserver;
  private unsubscribeQuality: () => void;
  /** The arm this view shows (options.arm); only the static view, and only while the layout is split, may half-rate. */
  private readonly arm: 'encore' | 'static' | undefined;
  private layout: 'split' | 'encore' | 'static' = 'encore';
  private level = 0;
  private halfRate = false;
  private frameCount = 0;

  /**
   * options.arm: which world this view shows. The half-rate quality rung applies to the static view only while the
   * layout is split (setLayout), never to a view shown alone. options.quality: test seam; the app uses the shared one.
   */
  constructor(
    private host: HTMLElement, params: Params, readonly rig: CameraRig,
    options: { arm?: 'encore' | 'static'; quality?: QualityController } = {},
  ) {
    const quality = options.quality ?? sharedQuality();
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-label', 'Three dimensional drone airspace');
    host.append(this.renderer.domElement);
    this.arm = options.arm;
    this.layers = createLayers();
    for (const layer of this.layers) layer.init({ scene: this.scene, camera: rig.camera, params });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.unsubscribeQuality = quality.subscribe(level => this.applyQuality(level));
  }

  /** Rendering costs only: pixel ratio, half-rate static pane, and each layer's own trims. */
  private applyQuality(level: number): void {
    // setPixelRatio re-applies the current size, so the drawing buffer follows at once.
    this.renderer.setPixelRatio(level >= PIXEL_RATIO_ONE_LEVEL ? 1 : Math.min(window.devicePixelRatio, 1.5));
    this.level = level;
    this.updateHalfRate();
    for (const layer of this.layers) layer.setQuality?.(level);
  }

  /** The app's current layout. Called whenever it changes (main.ts layoutViews). */
  setLayout(layout: 'split' | 'encore' | 'static'): void {
    this.layout = layout;
    this.updateHalfRate();
  }

  /** True while this view skips every other frame (quality rung 4, static view, split layout). For tests. */
  get halfRateActive(): boolean { return this.halfRate; }

  private updateHalfRate(): void {
    this.halfRate = this.arm === 'static' && this.layout === 'split' && this.level >= HALF_RATE_LEVEL;
  }

  resize(): void {
    const { width, height } = this.host.getBoundingClientRect();
    this.renderer.setSize(Math.max(width, 1), Math.max(height, 1));
    this.rig.resize(width, height);
  }

  /** Every simulation tick's snapshot, in order, before any render of it (#46). */
  ingest(snapshot: WorldSnapshot): void {
    for (const layer of this.layers) layer.ingest?.(snapshot);
  }

  /** The world was rebuilt: layers drop retained evidence. */
  reset(): void {
    for (const layer of this.layers) layer.reset?.();
  }

  /** `updateRig: false` when several views share one rig and the caller updates it once per frame. */
  render(frame: LayerFrame, updateRig = true): void {
    // Half rate: skip every other frame entirely (layers and GL). Ingest still sees every tick (#46), so no
    // evidence is lost; the camera rig of a split is updated once per frame by the caller.
    if (this.halfRate && this.frameCount++ % 2 === 1) return;
    for (const layer of this.layers) layer.update(frame);
    if (updateRig) this.rig.update();
    this.renderer.render(this.scene, this.rig.camera);
  }

  dispose(): void {
    this.unsubscribeQuality();
    this.resizeObserver.disconnect();
    for (const layer of this.layers) layer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
