// Rendering layer (prototype). Draws snapshots, observer slot status and the real radio log. Decides nothing.
// One WebGL canvas; split view renders both worlds with scissor rectangles and one shared camera, so the
// Encore (top) and static (bottom) images are always aligned (experience doc §5).
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, DynamicDrawUsage, GridHelper, Group, InstancedMesh,
  LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, PlaneGeometry, Points,
  PointsMaterial, RingGeometry, Scene, SphereGeometry, Sprite, SpriteMaterial, Vector2, Vector3, WebGLRenderer,
  DoubleSide, EdgesGeometry, IcosahedronGeometry,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DT } from '@encore/contracts';
import type { DroneSnap, Params, Recipe, Vec3 } from '@encore/contracts';
import { expandRecipe } from '@encore/score';
import type { Arm, ArmState, Session } from '../engine/session';
import type { CameraPreset, Store } from '../ui/store';
import { hexToRgb, type VersionPalette } from '../ui/store';

const PRESETS: Record<CameraPreset, Vec3> = { audience: [0, 6, 95], quarter: [55, 45, 75], top: [0, 140, 0.1] };
const LOOK: Vec3 = [0, 30, 0];
const C = {
  hbPlain: new Color('#5d7482').multiplyScalar(0.45), hbClaim: new Color('#38e1f0'), score: new Color('#ff4fd8'),
  lost: new Color('#8a959c'), jammed: new Color('#ff5a1f'), partitioned: new Color('#f5d90a'),
  transit: new Color('#ffb547'), vacant: new Color('#ff5a1f'), contested: new Color('#ff4fd8'),
  sideA: hexToRgb('#56B4E9'), sideB: hexToRgb('#F0E442'),
};

function ringTexture(): CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(255,255,255,0.5)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}
function outlineTexture(): CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 7;
  g.beginPath(); g.arc(32, 32, 24, 0, Math.PI * 2); g.stroke();
  return new CanvasTexture(c);
}
function labelSprite(text: string, colour = '#6f8a97'): Sprite {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = colour; g.font = '600 34px "JetBrains Mono Variable", ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 32, 34);
  const s = new Sprite(new SpriteMaterial({ map: new CanvasTexture(c), transparent: true, depthWrite: false }));
  s.scale.set(1.8, 1.8, 1);
  return s;
}

interface Link { a: Vec3; b: Vec3; colour: Color; born: number }

/** Everything drawn for one world. */
class ArmView {
  readonly scene = new Scene();
  private points: InstancedMesh; private halos: InstancedMesh;
  private deaf: InstancedMesh; private ghosts: Record<'inTransit' | 'vacant' | 'contested', InstancedMesh>;
  private links: Link[] = [];
  private linkGeo = new BufferGeometry(); private linkLines: LineSegments;
  private tetherGeo = new BufferGeometry(); private tethers: LineSegments;
  private crossGeo = new BufferGeometry(); private crosses: LineSegments;
  private flashes: Points; private flashAge: Float32Array; private flashPos: Float32Array;
  private jams = new Group(); private planes = new Group();
  private selection = new Group(); private selRing: Mesh; private senseSphere: LineSegments; private radioRing: Mesh; private targetMark: LineSegments;
  private senseGeo = new BufferGeometry(); private senseLines: LineSegments;
  private aliveBefore: boolean[] = [];
  private lastRadioTick = 0;
  drawnHistory: { tick: number; drawn: number; logged: number }[] = [];
  private hbCounter = 0;
  private dummy = new Object3D();
  private col = new Color();

  constructor(readonly arm: Arm, private params: Params, sprite: CanvasTexture) {
    const n = params.n0;
    const sphere = new SphereGeometry(0.24, 10, 8);
    this.points = new InstancedMesh(sphere, new MeshBasicMaterial({ toneMapped: false }), n);
    this.halos = new InstancedMesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: sprite, transparent: true, opacity: 0.42, blending: AdditiveBlending, depthWrite: false, toneMapped: false }), n);
    this.deaf = new InstancedMesh(new RingGeometry(0.55, 0.62, 32), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: DoubleSide, depthWrite: false }), n);
    const ring = (inner: number, outer: number, colour: Color, double = false) => {
      const geo = new RingGeometry(inner, outer, 28);
      if (double) {
        const g2 = new RingGeometry(inner + 0.22, outer + 0.22, 28);
        const merged = new BufferGeometry();
        const p1 = geo.getAttribute('position').array as Float32Array; const p2 = g2.getAttribute('position').array as Float32Array;
        const pos = new Float32Array(p1.length + p2.length); pos.set(p1); pos.set(p2, p1.length);
        const i1 = geo.getIndex()!.array; const i2 = g2.getIndex()!.array; const off = p1.length / 3;
        const idx = new Uint32Array(i1.length + i2.length); idx.set(i1); for (let i = 0; i < i2.length; i++) idx[i1.length + i] = i2[i] + off;
        merged.setAttribute('position', new BufferAttribute(pos, 3)); merged.setIndex(new BufferAttribute(idx, 1));
        return new InstancedMesh(merged, new MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.9, side: DoubleSide, depthWrite: false }), n);
      }
      return new InstancedMesh(geo, new MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.85, side: DoubleSide, depthWrite: false }), n);
    };
    this.ghosts = { inTransit: ring(0.42, 0.47, C.transit), vacant: ring(0.38, 0.56, C.vacant), contested: ring(0.36, 0.43, C.contested, true) };
    for (const m of [this.points, this.halos, this.deaf, ...Object.values(this.ghosts)]) {
      m.instanceMatrix.setUsage(DynamicDrawUsage); m.frustumCulled = false; m.count = 0; this.scene.add(m);
    }
    this.linkGeo.setAttribute('position', new BufferAttribute(new Float32Array(6000 * 6), 3).setUsage(DynamicDrawUsage));
    this.linkGeo.setAttribute('color', new BufferAttribute(new Float32Array(6000 * 6), 3).setUsage(DynamicDrawUsage));
    this.linkLines = new LineSegments(this.linkGeo, new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }));
    this.linkLines.frustumCulled = false;
    this.tetherGeo.setAttribute('position', new BufferAttribute(new Float32Array(n * 6), 3).setUsage(DynamicDrawUsage));
    this.tethers = new LineSegments(this.tetherGeo, new LineBasicMaterial({ color: C.transit, transparent: true, opacity: 0.5 }));
    this.tethers.frustumCulled = false;
    this.crossGeo.setAttribute('position', new BufferAttribute(new Float32Array(n * 12), 3).setUsage(DynamicDrawUsage));
    this.crosses = new LineSegments(this.crossGeo, new LineBasicMaterial({ color: 0x8195a0, transparent: true, opacity: 0.55 }));
    this.crosses.frustumCulled = false;
    this.flashPos = new Float32Array(n * 3); this.flashAge = new Float32Array(n).fill(99);
    const fg = new BufferGeometry();
    fg.setAttribute('position', new BufferAttribute(this.flashPos, 3).setUsage(DynamicDrawUsage));
    fg.setAttribute('color', new BufferAttribute(new Float32Array(n * 3), 3).setUsage(DynamicDrawUsage));
    this.flashes = new Points(fg, new PointsMaterial({ size: 2.6, map: sprite, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }));
    this.flashes.frustumCulled = false;
    // Selection: four arcs (shape differs from the deaf ring, so the two never read alike), sensing sphere, radio ring, target cross.
    const arcs = new BufferGeometry();
    const arcPts: number[] = [];
    for (let k = 0; k < 4; k++) for (let i = 0; i < 6; i++) {
      const a0 = k * Math.PI / 2 + 0.25 + i * 0.18, a1 = a0 + 0.18;
      arcPts.push(Math.cos(a0) * 0.95, Math.sin(a0) * 0.95, 0, Math.cos(a1) * 0.95, Math.sin(a1) * 0.95, 0);
    }
    arcs.setAttribute('position', new BufferAttribute(new Float32Array(arcPts), 3));
    this.selRing = new Mesh(new RingGeometry(0.9, 1.0, 40), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, side: DoubleSide }));
    this.selRing.add(new LineSegments(arcs, new LineBasicMaterial({ color: 0xffffff })));
    this.senseSphere = new LineSegments(new EdgesGeometry(new IcosahedronGeometry(params.rSense, 2)), new LineBasicMaterial({ color: 0x9fb4bf, transparent: true, opacity: 0.12 }));
    this.radioRing = new Mesh(new RingGeometry(params.rRadio - 0.06, params.rRadio + 0.06, 96), new MeshBasicMaterial({ color: 0x9fb4bf, transparent: true, opacity: 0.35, side: DoubleSide }));
    this.radioRing.rotation.x = -Math.PI / 2;
    const tm = new BufferGeometry();
    tm.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0, -0.5, 0, 0, 0.5, 0, 0, 0, -0.5, 0, 0, 0.5]), 3));
    this.targetMark = new LineSegments(tm, new LineBasicMaterial({ color: 0xffffff }));
    this.senseGeo.setAttribute('position', new BufferAttribute(new Float32Array(n * 6), 3).setUsage(DynamicDrawUsage));
    this.senseLines = new LineSegments(this.senseGeo, new LineBasicMaterial({ color: 0xcfe8ef, transparent: true, opacity: 0.22 }));
    this.senseLines.frustumCulled = false;
    this.selection.add(this.selRing, this.senseSphere, this.radioRing, this.targetMark, this.senseLines);
    this.selection.visible = false;
    const grid = new GridHelper(240, 48, 0x1d3846, 0x0f2330);
    (grid.material as LineBasicMaterial).transparent = true; (grid.material as LineBasicMaterial).opacity = 0.55;
    const axes = new BufferGeometry();
    axes.setAttribute('position', new BufferAttribute(new Float32Array([0, 0.02, 0, 5, 0.02, 0, 0, 0.02, 0, 0, 5, 0, 0, 0.02, 0, 0, 0.02, 5]), 3));
    const axisLines = new LineSegments(axes, new LineBasicMaterial({ color: 0x4f6976 }));
    const group = new Group(); group.position.set(-36, 0, -12); group.name = 'axes';
    const lx = labelSprite('X'); lx.position.set(6.2, 0.4, 0);
    const ly = labelSprite('Y'); ly.position.set(0, 6.2, 0);
    const lz = labelSprite('Z'); lz.position.set(0, 0.4, 6.2);
    group.add(axisLines, lx, ly, lz);
    this.scene.add(grid, group, this.linkLines, this.tethers, this.crosses, this.flashes, this.jams, this.planes, this.selection);
  }

  update(a: ArmState, alpha: number, camera: PerspectiveCamera, ctx: RenderCtx) {
    const { lenses } = ctx.store.state;
    const n0 = this.params.n0;
    const prev = a.prev, curr = a.curr;
    const q = camera.quaternion;
    const previewing = ctx.store.state.preview !== null;
    const dim = lenses.xray ? 0.25 : previewing ? 0.14 : 1;
    // Group tint only in show colours: in the belief lens, colour must mean version and nothing else.
    const partitioned = lenses.zones && lenses.colour === 'show' && curr.partitions.length > 0;
    let count = 0, deafCount = 0;
    const tmp: Vec3 = [0, 0, 0];
    const posOf = (d: DroneSnap): Vec3 => {
      const b = prev.drones[d.id];
      tmp[0] = b.pos[0] + (d.pos[0] - b.pos[0]) * alpha; tmp[1] = b.pos[1] + (d.pos[1] - b.pos[1]) * alpha; tmp[2] = b.pos[2] + (d.pos[2] - b.pos[2]) * alpha;
      return tmp;
    };
    const hoverId = ctx.store.state.hovered?.arm === this.arm || ctx.store.state.view !== 'split' ? ctx.store.state.hovered?.id ?? -1 : -1;
    for (const d of curr.drones) {
      if (!d.alive) continue;
      const p = posOf(d);
      let rgb: readonly number[] = d.colour;
      if (lenses.colour === 'belief') rgb = hexToRgb(ctx.palette.colour(`${d.belief.version.issuedTick}:${d.belief.version.origin}`));
      if (partitioned && d.partitionSide !== null) { const t = d.partitionSide ? C.sideB : C.sideA; rgb = [rgb[0] * 0.35 + t[0] * 0.65, rgb[1] * 0.35 + t[1] * 0.65, rgb[2] * 0.35 + t[2] * 0.65]; }
      this.dummy.position.set(p[0], p[1], p[2]); this.dummy.quaternion.identity();
      this.dummy.scale.setScalar(d.id === hoverId ? 1.8 : 1); this.dummy.updateMatrix();
      this.points.setMatrixAt(count, this.dummy.matrix);
      this.col.setRGB(rgb[0] * dim, rgb[1] * dim, rgb[2] * dim);
      this.points.setColorAt(count, this.col);
      this.dummy.quaternion.copy(q); this.dummy.scale.setScalar(ctx.halos && !previewing ? 3.2 : 0.001); this.dummy.updateMatrix();
      this.halos.setMatrixAt(count, this.dummy.matrix); this.halos.setColorAt(count, this.col);
      if (d.belief.deaf) { this.dummy.scale.setScalar(1); this.dummy.updateMatrix(); this.deaf.setMatrixAt(deafCount++, this.dummy.matrix); }
      count++;
    }
    this.points.count = count; this.halos.count = count; this.deaf.count = deafCount;
    for (const m of [this.points, this.halos, this.deaf]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }

    // Death: one 0.4 s flash, then hidden; in X-ray a dim × stays (experience doc §3).
    const fp = this.flashes.geometry.getAttribute('position') as BufferAttribute;
    const fc = this.flashes.geometry.getAttribute('color') as BufferAttribute;
    const cp = this.crossGeo.getAttribute('position') as BufferAttribute;
    let crossN = 0;
    for (const d of curr.drones) {
      const was = this.aliveBefore[d.id] ?? true;
      if (was && !d.alive) { this.flashAge[d.id] = 0; }
      this.aliveBefore[d.id] = d.alive;
      if (!d.alive) {
        this.flashAge[d.id] += ctx.dtReal;
        const age = this.flashAge[d.id];
        const k = ctx.reducedMotion ? (age < 0.4 ? 0.6 : 0) : Math.max(0, 1 - age / 0.4);
        fp.setXYZ(d.id, d.pos[0], d.pos[1], d.pos[2]);
        fc.setXYZ(d.id, k, k * 0.82, k * 0.7);
        if (lenses.xray && crossN < n0) {
          const s = 0.35, [x, y, z] = d.pos, o = crossN * 12;
          (cp.array as Float32Array).set([x - s, y - s, z, x + s, y + s, z, x - s, y + s, z, x + s, y - s, z], o);
          crossN++;
        }
      } else { fc.setXYZ(d.id, 0, 0, 0); this.flashAge[d.id] = 99; }
    }
    fp.needsUpdate = true; fc.needsUpdate = true; cp.needsUpdate = true;
    this.crossGeo.setDrawRange(0, crossN * 4);

    // Ghost slots from Observer.slotStatus only; the app never recomputes status.
    const showGhosts = lenses.ghosts;
    for (const m of Object.values(this.ghosts)) m.count = 0;
    if (showGhosts) {
      const st = a.observer.slotStatus(curr);
      const counts = { inTransit: 0, vacant: 0, contested: 0 };
      st.status.forEach((s, i) => {
        if (s === 'occupied') return;
        const slot = st.formation.slots[i];
        const scale = 1.35 - 0.6 * (i / n0);
        this.dummy.position.set(slot.pos[0], slot.pos[1], slot.pos[2]); this.dummy.quaternion.copy(q);
        this.dummy.scale.setScalar(s === 'contested' && !ctx.reducedMotion ? scale * (1 + 0.08 * Math.sin(ctx.time * 3)) : scale); this.dummy.updateMatrix();
        this.ghosts[s].setMatrixAt(counts[s]++, this.dummy.matrix);
      });
      for (const k of ['inTransit', 'vacant', 'contested'] as const) { this.ghosts[k].count = counts[k]; this.ghosts[k].instanceMatrix.needsUpdate = true; }
    }

    // Tethers: drone → its own belief.target, never to a reference slot.
    const tp = this.tetherGeo.getAttribute('position') as BufferAttribute;
    let tn = 0;
    if (lenses.tethers) for (const d of curr.drones) {
      if (!d.alive) continue;
      const t = d.belief.target;
      const dx = d.pos[0] - t[0], dy = d.pos[1] - t[1], dz = d.pos[2] - t[2];
      if (dx * dx + dy * dy + dz * dz <= this.params.rOcc ** 2) continue;
      const p = posOf(d);
      (tp.array as Float32Array).set([p[0], p[1], p[2], t[0], t[1], t[2]], tn * 6); tn++;
    }
    tp.needsUpdate = true; this.tetherGeo.setDrawRange(0, tn * 2);
    this.tethers.visible = lenses.tethers;

    // Radio X-ray from the real RadioEvent log. Fade is in sim ticks, so pause freezes lines.
    for (const h of a.radioHistory) {
      if (h.tick <= this.lastRadioTick) continue;
      this.lastRadioTick = h.tick;
      let drawn = 0, logged = 0;
      for (const r of h.radio) {
        logged += r.delivered.length;
        if (!lenses.xray) continue;
        const from = curr.drones[r.from].pos;
        let colour: Color, cap: number;
        if (r.type === 'SCORE') { colour = C.score; cap = 14; }
        else if (r.claimSlot !== null) { colour = C.hbClaim; cap = 10; }
        else { if (!ctx.plainHb || (this.hbCounter++ % 4) !== 0) continue; colour = C.hbPlain; cap = 3; }
        for (let i = 0; i < Math.min(cap, r.delivered.length); i++) {
          const to = curr.drones[r.delivered[i]].pos;
          this.links.push({ a: [from[0], from[1], from[2]], b: [to[0], to[1], to[2]], colour, born: h.tick }); drawn++;
        }
        // Dropped stubs point at nobody: the log holds counts, not receiver ids.
        const reasons: [number, Color][] = [[r.lost, C.lost], [r.jammed, C.jammed], [r.partitioned, C.partitioned]];
        reasons.forEach(([n, c], k) => {
          if (!n) return;
          const ang = (r.from * 2.399 + k * 2.09);
          this.links.push({ a: [from[0], from[1], from[2]], b: [from[0] + Math.cos(ang) * 0.9, from[1] + Math.sin(ang) * 0.9, from[2]], colour: c, born: h.tick });
        });
      }
      this.drawnHistory.push({ tick: h.tick, drawn, logged });
      if (this.drawnHistory.length > 20) this.drawnHistory.shift();
    }
    const nowTick = curr.tick + (ctx.playing ? alpha : 0);
    this.links = this.links.filter(l => nowTick - l.born < 6);
    if (this.links.length > 6000) this.links.splice(0, this.links.length - 6000);
    const lp = this.linkGeo.getAttribute('position') as BufferAttribute, lc = this.linkGeo.getAttribute('color') as BufferAttribute;
    const lpa = lp.array as Float32Array, lca = lc.array as Float32Array;
    this.links.forEach((l, i) => {
      const k = Math.max(0, 1 - (nowTick - l.born) / 6);
      lpa.set(l.a, i * 6); lpa.set(l.b, i * 6 + 3);
      const r = l.colour.r * k, g = l.colour.g * k, b = l.colour.b * k;
      lca.set([r, g, b, r * 0.6, g * 0.6, b * 0.6], i * 6);
    });
    lp.needsUpdate = true; lc.needsUpdate = true; this.linkGeo.setDrawRange(0, this.links.length * 2);
    this.linkLines.visible = lenses.xray;

    // Zones: drawn from snapshot.jams and snapshot.partitions, never from UI state.
    const showJ = lenses.zones || lenses.xray;
    this.sync(this.jams, showJ ? curr.jams.map(j => [`${j.id}:${j.radius}:${j.centre.join(',')}`, () => {
      const g = new Group(); g.position.set(...j.centre);
      g.add(new LineSegments(new EdgesGeometry(new IcosahedronGeometry(j.radius, 1)), new LineBasicMaterial({ color: C.jammed, transparent: true, opacity: 0.16 })));
      g.add(new Mesh(new SphereGeometry(j.radius, 32, 16), new MeshBasicMaterial({ color: C.jammed, transparent: true, opacity: 0.045, depthWrite: false })));
      return g;
    }] as [string, () => Object3D]) : []);
    this.sync(this.planes, lenses.zones ? curr.partitions.map(p => [`${p.id}`, () => {
      const plane = new Mesh(new PlaneGeometry(70, 50), new MeshBasicMaterial({ color: C.partitioned, transparent: true, opacity: 0.025, side: DoubleSide, depthWrite: false }));
      plane.position.set(...p.point);
      plane.lookAt(p.point[0] + p.normal[0], p.point[1] + p.normal[1], p.point[2] + p.normal[2]);
      plane.add(new LineSegments(new EdgesGeometry(new PlaneGeometry(70, 50)), new LineBasicMaterial({ color: C.partitioned, transparent: true, opacity: 0.3 })));
      return plane;
    }] as [string, () => Object3D]) : []);

    // Selection: built only from World.inspect(id) and that drone's Belief (experience doc §6).
    const sel = ctx.store.state.selected;
    this.selection.visible = false;
    if (sel && (sel.arm === this.arm || ctx.store.state.view !== 'split')) {
      const ins = a.world.inspect(sel.id);
      const belief = curr.drones[sel.id]?.belief;
      if (ins && belief) {
        const alive = curr.drones[sel.id].alive;
        const step = alive ? (1 + alpha) * DT : 0;
        const p: Vec3 = [ins.input.pos[0] + ins.input.vel[0] * step, ins.input.pos[1] + ins.input.vel[1] * step, ins.input.pos[2] + ins.input.vel[2] * step];
        this.selection.visible = true;
        this.selRing.position.set(...p); this.selRing.quaternion.copy(q);
        const nb = lenses.neighbourhood;
        this.senseSphere.visible = nb; this.radioRing.visible = nb; this.senseLines.visible = nb;
        this.senseSphere.position.set(...p); this.radioRing.position.set(...p);
        this.targetMark.position.set(...belief.target);
        const sp = this.senseGeo.getAttribute('position') as BufferAttribute;
        ins.input.sensed.forEach((s, i) => { if (i < n0) (sp.array as Float32Array).set([p[0], p[1], p[2], ins.input.pos[0] + s.rel[0], ins.input.pos[1] + s.rel[1], ins.input.pos[2] + s.rel[2]], i * 6); });
        sp.needsUpdate = true; this.senseGeo.setDrawRange(0, ins.input.sensed.length * 2);
      }
    }
  }

  /** Keep a group's children in step with keyed descriptions, disposing what disappears. */
  private sync(group: Group, items: [string, () => Object3D][]) {
    const want = new Set(items.map(([k]) => k));
    for (const child of [...group.children]) if (!want.has(child.name)) {
      group.remove(child);
      child.traverse(o => { const m = o as Mesh; m.geometry?.dispose(); (m.material as MeshBasicMaterial | undefined)?.dispose?.(); });
    }
    for (const [k, make] of items) if (!group.children.some(c => c.name === k)) { const o = make(); o.name = k; group.add(o); }
  }

  resetTransient() { this.links = []; this.aliveBefore = []; this.lastRadioTick = 0; this.drawnHistory = []; this.flashAge.fill(99); }
}

export interface RenderCtx { store: Store; palette: VersionPalette; dtReal: number; time: number; halos: boolean; plainHb: boolean; playing: boolean; reducedMotion: boolean }

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(50, 1, 0.1, 1200);
  readonly controls: OrbitControls;
  private views: Record<Arm, ArmView>;
  private overlay = new Scene();
  private preview: Points | null = null;
  private pickSphere: Mesh;
  private tween: { from: Vector3; to: Vector3; t: number } | null = null;
  private time = 0;
  quality: 'high' | 'low' = 'high';
  /** Height covered by the bottom trays; split view stacks both worlds above it so neither is hidden. */
  insetBottom = 0;
  fps = 60;
  private frames = 0; private acc = 0;

  constructor(private host: HTMLElement, private session: Session, private store: Store, private palette: VersionPalette) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x03080e, 1);
    this.renderer.autoClear = false;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', '3D view of the drone swarm. Drag to orbit, right-drag to pan, scroll to zoom, click a drone to inspect it.');
    this.renderer.domElement.tabIndex = 0;
    this.camera.position.set(...PRESETS.audience);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(...LOOK);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 8; this.controls.maxDistance = 260; this.controls.maxPolarAngle = Math.PI * 0.95;
    this.controls.addEventListener('start', () => { this.tween = null; this.store.set({ camera: null }); });
    const sprite = ringTexture();
    this.views = { encore: new ArmView('encore', session.params, sprite), static: new ArmView('static', session.params, sprite) };
    this.pickSphere = new Mesh(new SphereGeometry(1, 32, 16), new MeshBasicMaterial({ color: 0xcfe8ef, transparent: true, opacity: 0.08, depthWrite: false }));
    this.pickSphere.add(new LineSegments(new EdgesGeometry(new IcosahedronGeometry(1, 2)), new LineBasicMaterial({ color: 0xcfe8ef, transparent: true, opacity: 0.4 })));
    this.pickSphere.visible = false;
    this.overlay.add(this.pickSphere);
    session.onReset(() => { this.views.encore.resetTransient(); this.views.static.resetTransient(); });
    store.subscribe((s, changed) => {
      if (changed.includes('preview')) this.setPreview(s.preview?.recipe ?? null);
      if (changed.includes('camera') && s.camera) this.goTo(s.camera);
    });
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.renderer.setSize(w, h, false);
  }

  goTo(preset: CameraPreset) {
    const to = new Vector3(...PRESETS[preset]);
    if (this.store.state.reducedMotion) { this.camera.position.copy(to); this.controls.target.set(...LOOK); this.controls.update(); return; }
    this.tween = { from: this.camera.position.clone(), to, t: 0 };
  }

  private setPreview(recipe: Recipe | null) {
    if (this.preview) { this.overlay.remove(this.preview); this.preview.geometry.dispose(); this.preview = null; }
    if (!recipe) return;
    const f = expandRecipe(recipe, this.session.params.n0, this.session.params);
    const pos = new Float32Array(f.slots.length * 3), col = new Float32Array(f.slots.length * 3);
    f.slots.forEach((s, i) => { pos.set(s.pos, i * 3); col.set(s.colour, i * 3); });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3)); g.setAttribute('color', new BufferAttribute(col, 3));
    // Hollow rings: a proposed target outline, never mistaken for a lit drone.
    this.preview = new Points(g, new PointsMaterial({ size: 2.2, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, map: outlineTexture() }));
    this.overlay.add(this.preview);
  }

  /** Region sphere that follows the pointer while picking a kill/jam centre. */
  setPickSphere(centre: Vec3 | null, radius = 1) {
    this.pickSphere.visible = !!centre;
    if (centre) { this.pickSphere.position.set(...centre); this.pickSphere.scale.setScalar(radius); }
  }

  private viewports(): { arm: Arm; x: number; y: number; w: number; h: number }[] {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const v = this.store.state.view;
    if (v === 'split') { const a = Math.max(200, h - this.insetBottom); return [{ arm: 'encore', x: 0, y: 0, w, h: a / 2 }, { arm: 'static', x: 0, y: a / 2, w, h: a / 2 }]; }
    return [{ arm: v, x: 0, y: 0, w, h }];
  }

  armAt(clientY: number): Arm {
    const r = this.host.getBoundingClientRect();
    const v = this.store.state.view;
    if (v !== 'split') return v;
    return clientY - r.top < Math.max(200, r.height - this.insetBottom) / 2 ? 'encore' : 'static';
  }

  private ndc(clientX: number, clientY: number): { ndc: Vector2; arm: Arm } {
    const r = this.host.getBoundingClientRect();
    const arm = this.armAt(clientY);
    const vp = this.viewports().find(v => v.arm === arm)!;
    const x = ((clientX - r.left - vp.x) / vp.w) * 2 - 1;
    const y = -((clientY - r.top - vp.y) / vp.h) * 2 + 1;
    this.applyViewport(vp);
    return { ndc: new Vector2(x, y), arm };
  }

  /** Screen-space nearest live drone within 16 px. */
  pick(clientX: number, clientY: number): { id: number; arm: Arm } | null {
    const r = this.host.getBoundingClientRect();
    const { arm } = this.ndc(clientX, clientY);
    const vp = this.viewports().find(v => v.arm === arm)!;
    const snap = this.session.arms[arm].curr;
    const v = new Vector3();
    let best = -1, bestD = 16 * 16;
    for (const d of snap.drones) {
      if (!d.alive) continue;
      v.set(...d.pos).project(this.camera);
      if (v.z > 1) continue;
      const sx = r.left + vp.x + (v.x + 1) / 2 * vp.w, sy = r.top + vp.y + (1 - v.y) / 2 * vp.h;
      const dd = (sx - clientX) ** 2 + (sy - clientY) ** 2;
      if (dd < bestD) { bestD = dd; best = d.id; }
    }
    return best >= 0 ? { id: best, arm } : null;
  }

  /** Pointer → world point on the plane through the formation centre facing the camera. */
  pointAt(clientX: number, clientY: number): Vec3 {
    const { ndc } = this.ndc(clientX, clientY);
    const origin = this.camera.position.clone();
    const dir = new Vector3(ndc.x, ndc.y, 0.5).unproject(this.camera).sub(origin).normalize();
    const normal = new Vector3(); this.camera.getWorldDirection(normal);
    const centre = new Vector3(...LOOK);
    const t = centre.clone().sub(origin).dot(normal) / Math.max(1e-6, dir.dot(normal));
    const p = origin.add(dir.multiplyScalar(t));
    return [p.x, p.y, p.z];
  }

  /** Screen position of a world point in the primary viewport (for DOM labels). */
  project(p: Vec3, arm: Arm = 'encore'): { x: number; y: number } | null {
    const vp = this.viewports().find(v => v.arm === arm) ?? this.viewports()[0];
    this.applyViewport(vp);
    const v = new Vector3(...p).project(this.camera);
    if (v.z > 1) return null;
    return { x: vp.x + (v.x + 1) / 2 * vp.w, y: vp.y + (1 - v.y) / 2 * vp.h };
  }

  /** Aspect per viewport; split halves get a modest zoom so the formation is not lost in a letterbox. */
  private applyViewport(vp: { w: number; h: number }) {
    this.camera.aspect = vp.w / Math.max(vp.h, 1);
    this.camera.zoom = this.store.state.view === 'split' ? 1.45 : 1;
    this.camera.updateProjectionMatrix();
  }

  radioCounter(arm: Arm): { drawn: number; logged: number } {
    return this.views[arm].drawnHistory.reduce((s, h) => ({ drawn: s.drawn + h.drawn, logged: s.logged + h.logged }), { drawn: 0, logged: 0 });
  }

  render(dtReal: number) {
    this.time += dtReal;
    this.frames++; this.acc += dtReal;
    if (this.acc >= 0.5) { this.fps = this.frames / this.acc; this.frames = 0; this.acc = 0; }
    if (this.tween) {
      this.tween.t = Math.min(1, this.tween.t + dtReal / 0.9);
      const e = 1 - Math.pow(1 - this.tween.t, 3);
      this.camera.position.lerpVectors(this.tween.from, this.tween.to, e);
      this.controls.target.lerp(new Vector3(...LOOK), e);
      if (this.tween.t >= 1) this.tween = null;
    }
    this.controls.update();
    const q = this.store.state.quality;
    const low = q === 'low' || (q === 'auto' && this.fps < 30);
    this.quality = low ? 'low' : 'high';
    const ctx: RenderCtx = { store: this.store, palette: this.palette, dtReal, time: this.time, halos: !low, plainHb: !low, playing: this.session.playing, reducedMotion: this.store.state.reducedMotion };
    for (const v of Object.values(this.views)) { const ax = v.scene.getObjectByName('axes'); if (ax) ax.visible = !this.store.state.chromeHidden; }
    const alpha = this.session.alpha;
    const h = this.host.clientHeight;
    this.renderer.setScissorTest(true);
    for (const vp of this.viewports()) {
      const view = this.views[vp.arm];
      view.update(this.session.arms[vp.arm], alpha, this.camera, ctx);
      this.applyViewport(vp);
      const y = h - vp.y - vp.h;
      this.renderer.setViewport(vp.x, y, vp.w, vp.h); this.renderer.setScissor(vp.x, y, vp.w, vp.h);
      this.renderer.clear();
      this.renderer.render(view.scene, this.camera);
      if (vp.arm === 'encore' || this.store.state.view === 'static') this.renderer.render(this.overlay, this.camera);
      if (this.preview && !this.store.state.reducedMotion) (this.preview.material as PointsMaterial).opacity = 0.65 + 0.25 * Math.sin(this.time * 2.4);
    }
    this.renderer.setScissorTest(false);
  }
}

