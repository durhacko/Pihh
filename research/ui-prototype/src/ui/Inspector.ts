// Drone inspector. Agent knowledge comes ONLY from World.inspect(id) and that drone's Belief (experience doc §6).
// The observer column is visually separate, hatched and labelled; it is the only part fed by the snapshot.
import type { AgentInput, AgentOutput, Belief, DroneSnap } from '@encore/contracts';
import type { App } from './app';
import { fmt, h, vec } from './dom';
import { icon } from './icons';

function jsonTree(value: unknown, key = 'state', depth = 0): HTMLElement {
  if (value === null || typeof value !== 'object') return h('div', { class: 'leaf' }, h('b', {}, `${key}: `), JSON.stringify(value));
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>);
  const shown = entries.slice(0, 60);
  const d = h('details', depth === 0 ? { open: true } : {}, h('summary', {}, `${key} ${Array.isArray(value) ? `[${value.length}]` : `{${entries.length}}`}`));
  for (const [k, v] of shown) d.append(jsonTree(v, k, depth + 1));
  if (entries.length > shown.length) d.append(h('div', { class: 'leaf' }, `… ${entries.length - shown.length} more`));
  return d;
}

export function createInspector(app: App): HTMLElement {
  const { session, store } = app;
  // Interactive parts (head, actions, JSON tree) are rebuilt only when the selection or alive state changes;
  // the data sections refresh at 4 Hz without replacing anything a pointer may be pressing.
  const head = h('div', { class: 'panel-head' });
  const data = h('div', { style: { display: 'grid', gap: '16px' } });
  const det = h('details', { class: 'json' }, h('summary', {}, 'Raw private state', h('span', { class: 'hint' }, ' · generic tree')), h('div', { class: 'tree' }));
  const actionsRow = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
  const body = h('div', { class: 'body' }, data, det, actionsRow);
  const el = h('aside', { class: 'side right surface chrome', 'aria-label': 'Drone inspector' }, head, body);
  let lastKey = '';
  let shellKey = '';
  let treeAt = -1;
  det.addEventListener('toggle', () => { treeAt = -1; if (det.open) render(true); });

  function render(force = false) {
    const sel = store.state.selected;
    if (!sel) return;
    const arm = session.arms[sel.arm];
    const snap: DroneSnap | undefined = arm.curr.drones[sel.id];
    const ins = arm.world.inspect(sel.id) as { input: AgentInput; output: AgentOutput; state: unknown } | null;
    if (!snap) return;
    const belief: Belief = snap.belief;
    const key = `${sel.arm}:${sel.id}:${arm.curr.tick}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    const vk = `${belief.version.issuedTick}:${belief.version.origin}`;
    const sk = `${sel.arm}:${sel.id}:${snap.alive}:${belief.deaf}`;
    const shell = sk !== shellKey;
    shellKey = sk;
    if (shell) { head.innerHTML = ''; head.append(
      h('div', { class: 'ins-head' },
        h('span', { class: 'eyebrow' }, 'Drone'), h('span', { class: 'ins-id' }, `#${sel.id}`),
        h('span', { class: 'pill arm' }, sel.arm === 'encore' ? 'ENCORE' : 'STATIC'),
        snap.alive ? null : h('span', { class: 'pill dead' }, 'dead'),
        snap.alive && belief.deaf ? h('span', { class: 'pill deaf', title: 'No radio heard for tDeaf' }, 'deaf') : null),
      h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn', 'aria-label': 'Previous drone', html: icon.chevL, onclick: () => step(-1) }),
      h('button', { class: 'icon-btn', 'aria-label': 'Next drone', html: icon.chevR, onclick: () => step(1) }),
      h('button', { class: 'icon-btn', 'aria-label': 'Close inspector', html: icon.close, onclick: () => app.actions.select(null) })); }

    data.innerHTML = '';
    if (!snap.alive) data.append(h('div', { class: 'banner' }, `Dead since tick ${snap.diedTick}. Showing its final step, frozen.`));
    if (!ins) { data.append(h('div', { class: 'empty' }, 'No step recorded yet.')); return; }
    const inboxHB = ins.input.inbox.filter(m => m.type === 'HB').length, inboxSC = ins.input.inbox.length - inboxHB;
    const outHB = ins.output.outbox.filter(m => m.type === 'HB').length, outSC = ins.output.outbox.length - outHB;
    const nearest = ins.input.sensed.reduce((m, s) => Math.min(m, Math.hypot(...s.rel)), Infinity);
    const speed = Math.hypot(...ins.input.vel);
    const dist = Math.hypot(ins.input.pos[0] - belief.target[0], ins.input.pos[1] - belief.target[1], ins.input.pos[2] - belief.target[2]);

    const knowledge = h('section', { class: 'knowledge', 'aria-label': 'Agent knowledge' },
      h('div', { class: 'sec-title' }, h('span', { class: 'eyebrow' }, 'Agent knowledge'), h('span', { class: 'src' }, 'Belief · inspect()')),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Slot'), h('dd', {}, `${belief.slot}  · held since t${belief.heldSince}`),
        h('dt', {}, 'Flying to'), h('dd', {}, `${vec(belief.target)}  · ${fmt(dist, 1)} m away`),
        h('dt', {}, 'Score version'), h('dd', {}, h('span', { style: { display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: app.palette.colour(vk), marginRight: '6px' } }), `v${vk}${belief.version.origin === -1 ? ' (preloaded)' : ` (uplink via #${belief.version.origin})`}`),
        h('dt', {}, 'Healing'), h('dd', {}, belief.canHeal ? 'eligible (canHeal)' : 'not eligible'),
        h('dt', {}, 'Claim'), h('dd', {}, belief.claiming === null ? 'none' : `claiming slot ${belief.claiming}`),
        h('dt', {}, 'Radio'), h('dd', {}, `${belief.deaf ? 'DEAF · ' : ''}${belief.peersKnown} peers heard recently`),
        h('dt', {}, 'Inbox (last tick)'), h('dd', {}, `${inboxHB} HB · ${inboxSC} SCORE`),
        h('dt', {}, 'Sent (last tick)'), h('dd', {}, `${outHB} HB · ${outSC} SCORE`),
        h('dt', {}, 'Senses'), h('dd', {}, `${ins.input.sensed.length} drones · nearest ${Number.isFinite(nearest) ? fmt(nearest, 2) + ' m' : '—'}`),
        h('dt', {}, 'Own body'), h('dd', {}, `${vec(ins.input.pos)} · ${fmt(speed, 1)} m/s`),
        h('dt', {}, 'Output accel'), h('dd', {}, vec(ins.output.accel, 2))),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Recent decisions'),
        belief.log.length ? h('ul', { class: 'loglist' }, ...belief.log.slice().reverse().map(l => h('li', { title: l }, l))) : h('div', { class: 'empty' }, sel.arm === 'static' ? 'The static brain makes no decisions.' : 'No decisions yet: holding its slot.')),
    );
    // The tree is generic (no field names hard-coded) and refreshes at most once a second while open.
    if (det.open && (shell || arm.curr.tick - treeAt >= 20 || treeAt < 0)) {
      treeAt = arm.curr.tick;
      const t = det.querySelector('.tree')!; const sc = t.scrollTop; t.innerHTML = ''; t.append(jsonTree(ins.state)); t.scrollTop = sc;
    }

    // Observer truth. Never shown to, or derived from, the brain.
    const st = arm.observer.slotStatus(arm.curr);
    const inJam = arm.curr.jams.filter(j => Math.hypot(snap.pos[0] - j.centre[0], snap.pos[1] - j.centre[1], snap.pos[2] - j.centre[2]) <= j.radius).map(j => j.id);
    const r2 = session.params.rRadio ** 2;
    let liveNear = 0, deadNear = 0;
    for (const o of arm.curr.drones) {
      if (o.id === snap.id) continue;
      const d2 = (o.pos[0] - snap.pos[0]) ** 2 + (o.pos[1] - snap.pos[1]) ** 2 + (o.pos[2] - snap.pos[2]) ** 2;
      if (d2 <= r2) { if (o.alive) liveNear++; else deadNear++; }
    }
    const observer = h('section', { class: 'observer', 'aria-label': 'Observer information, not visible to this drone' },
      h('div', { class: 'sec-title' }, h('span', { class: 'tag obs' }, 'Observer'), h('span', { class: 'hint' }, 'not visible to this drone')),
      h('dl', { class: 'kv' },
        h('dt', {}, 'True state'), h('dd', {}, snap.alive ? 'alive' : `dead (t${snap.diedTick})`),
        h('dt', {}, 'Its slot, per observer'), h('dd', {}, st.status[belief.slot] ?? '—'),
        h('dt', {}, 'Jammed now'), h('dd', {}, inJam.length ? `yes (${inJam.join(', ')})` : 'no'),
        h('dt', {}, 'Partition group'), h('dd', {}, snap.partitionSide === null ? '—' : String(snap.partitionSide)),
        h('dt', {}, 'In radio range'), h('dd', {}, `${liveNear} live · ${deadNear} dead`)),
    );
    if (shell) { actionsRow.innerHTML = ''; actionsRow.append(
      h('button', { class: 'btn small', disabled: !snap.alive || sel.arm !== 'encore', onclick: () => { app.surfaces.open('composer'); } }, h('span', { html: icon.inject }), 'Inject here…'),
      h('button', { class: 'btn small', disabled: !snap.alive, onclick: () => app.actions.jam(12, snap.pos) }, h('span', { html: icon.jam }), 'Jam around'),
      h('button', { class: 'btn small danger', disabled: !snap.alive, onclick: () => app.actions.dispatch({ kind: 'kill', ids: [snap.id] }) }, h('span', { html: icon.kill }), 'Kill')); }
    data.append(knowledge, observer);
  }
  function step(dir: 1 | -1) {
    const sel = store.state.selected; if (!sel) return;
    const n = session.params.n0;
    let id = sel.id;
    for (let i = 0; i < n; i++) { id = (id + dir + n) % n; if (session.arms[sel.arm].curr.drones[id].alive) break; }
    store.set({ selected: { id, arm: sel.arm } });
  }
  store.subscribe((_s, changed) => { if (changed.includes('selected')) render(true); });
  let acc = 0;
  Object.assign(el, { tick: (dt: number) => {
    acc += dt;
    const hovering = el.matches(':hover');
    if (acc > (hovering ? 1.0 : 0.25)) { acc = 0; if (app.surfaces.isOpen('inspector')) render(); }
  } });
  return el;
}
