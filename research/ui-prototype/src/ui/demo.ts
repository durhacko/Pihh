// The 90-second scripted demo (experience doc §9). Each step uses the SAME actions as the buttons and console.
// Times are sim seconds at 1×, so the script follows the simulation clock, not the wall clock.
import type { Vec3 } from '@encore/contracts';
import { idsInSphere } from '../engine/session';
import type { App } from './app';

interface DemoStep { t: number; caption?: string; sub?: string; run?(app: App): void }

const STEPS: DemoStep[] = [
  { t: 0, caption: '200 drones. No controller. Each one decides for itself.', sub: 'launch into “ENCORE”', run: a => { a.actions.camera('audience'); a.store.set({ lenses: { colour: 'show', xray: false, ghosts: false, tethers: false, zones: true, neighbourhood: true }, view: 'encore' }); } },
  { t: 12, caption: 'X-ray: the real radio log — dim heartbeats, sampled one in four.', run: a => a.actions.lens('xray', true) },
  { t: 16, caption: 'Below: a conventional pre-programmed show, same seed, same events.', run: a => a.actions.setView('split') },
  { t: 20, caption: 'Destroy one letter in both worlds.', sub: 'KILL · same ids in both arms', run: a => {
    const snap = a.session.arms.encore.curr;
    const live = snap.drones.filter(d => d.alive);
    const minX = Math.min(...live.map(d => d.pos[0]));
    const left = live.filter(d => d.pos[0] < minX + 4);
    const c: Vec3 = [left.reduce((s, d) => s + d.pos[0], 0) / left.length, left.reduce((s, d) => s + d.pos[1], 0) / left.length, 0];
    let r = 3; while (idsInSphere(snap, c, r).length < a.session.params.n0 * 0.1 && r < 14) r += 0.5;
    a.actions.dispatch({ kind: 'killRegion', centre: c, radius: r }, true);
    a.actions.lens('ghosts', true);
  } },
  { t: 24, caption: 'Neighbours sense the gap, claim it over radio, and the least important drones move in.', sub: 'cyan = claim heartbeats · rings = observer slot status' },
  { t: 44, caption: 'Next movement: survivors re-form without a single message.', sub: 'slot persistence', run: a => { a.actions.setView('encore'); a.actions.lens('ghosts', false); } },
  { t: 54, caption: 'Jam the radio over the top of the formation.', sub: 'JAM_ON · white rings = deaf drones', run: a => {
    a.actions.lens('colour', 'belief');
    // Aim at where the swarm is heading: the observer's reference formation for this tick.
    const f = a.session.arms.encore.observer.slotStatus(a.session.arms.encore.curr).formation;
    const top = f.bounds.max[1], low = f.bounds.min[1];
    const cx = (f.bounds.min[0] + f.bounds.max[0]) / 2, cz = (f.bounds.min[2] + f.bounds.max[2]) / 2;
    const radius = Math.max(8, Math.round((top - low) / 3 + 3));
    a.actions.dispatch({ kind: 'jamOn', centre: [Math.round(cx), Math.round(top - radius / 3), Math.round(cz)], radius }, true);
  } },
  { t: 58, caption: 'Send a new composition to ONE drone outside the jam.', sub: 'INJECT_SCORE · magenta = SCORE messages', run: a => {
    const snap = a.session.arms.encore.curr;
    const jam = snap.jams[0];
    const far = (p: readonly number[]) => !jam || Math.hypot(p[0] - jam.centre[0], p[1] - jam.centre[1], p[2] - jam.centre[2]) > jam.radius + 4;
    const outside = (d: { pos: Vec3; belief: { target: Vec3 } }) => far(d.pos) && far(d.belief.target);
    const out = snap.drones.filter(d => d.alive && outside(d)).sort((x, y) => x.pos[1] - y.pos[1]);
    const target = out[0]?.id ?? 0;
    const draft = a.drafts.list.find(d => d.kind === 'sphere') ?? a.drafts.current;
    a.actions.inject(target, draft.id);
    a.actions.select(target, 'encore');
    a.actions.setSpeed(0.5);
  } },
  { t: 61, caption: 'Its colour spreads along real SCORE lines — and stops at the jam.', run: a => a.actions.setSpeed(1) },
  { t: 68, caption: 'Lift the jam. The new version crosses; late adopters join by the clock.', sub: 'JAM_OFF', run: a => { a.actions.unjam(); a.actions.select(null); } },
  { t: 82, caption: 'One score again. Every number here comes from the observer.', run: a => { a.store.set({ lenses: { colour: 'show', xray: false, ghosts: false, tethers: false, zones: true, neighbourhood: true } }); a.actions.camera('audience'); a.surfaces.open('metrics'); } },
  { t: 90 },
];

export function startDemo(app: App, onEnd: () => void): { stop(): void; update(): void } {
  app.actions.reset();
  app.session.playing = true; app.session.speed = 1;
  let i = 0, stopped = false;
  const ctl = {
    stop() { if (stopped) return; stopped = true; app.caption(null); app.actions.demo = null; onEnd(); },
    update() {
      if (stopped) return;
      while (i < STEPS.length && app.session.tick >= STEPS[i].t * 20) {
        const s = STEPS[i++];
        app.actions.quiet = true;            // captions narrate; feedback goes to the event log, not toasts
        try { s.run?.(app); } finally { app.actions.quiet = false; }
        if (s.caption) app.caption(s.caption, s.sub);
        if (i === STEPS.length) { app.caption(null); ctl.stop(); }
      }
    },
  };
  app.actions.demo = ctl;
  return ctl;
}
