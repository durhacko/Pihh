// Formation composer: define → validate → preview locally → choose ONE drone → inject.
// Editing never commands the swarm. The only thing that leaves this panel is an INJECT_SCORE into one drone.
import type { RGB } from '@encore/contracts';
import { expandRecipe } from '@encore/score';
import type { App, Draft } from './app';
import { h } from './dom';
import { icon } from './icons';
import { hexToRgb, rgbToHex } from './store';

const SWATCHES = ['#FFB000', '#FF3D7F', '#00C2A8', '#B6F500', '#9B7BFF', '#FFD84D', '#36C5F0', '#FF8C42'];
const DEFAULTS: Record<Draft['kind'], [string, string]> = { text: ['#FFB833', '#FF5280'], sphere: ['#36C5F0', '#9B7BFF'], helix: ['#00C2A8', '#B6F500'] };

export function createComposer(app: App): HTMLElement {
  const { drafts, store, session } = app;
  const closeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Close composer', html: icon.close, onclick: () => app.surfaces.close('composer') });
  const body = h('div', { class: 'body' });
  const foot = h('div', { class: 'foot' });
  const el = h('aside', { class: 'side left surface chrome', 'aria-label': 'Formation composer' },
    h('div', { class: 'panel-head' }, h('div', {}, h('h2', {}, 'Compose'), h('div', { class: 'sub' }, 'Drafts stay local until you transmit one.')), h('span', { class: 'spacer' }), closeBtn),
    body, foot);

  let pickedDrone: number | null = null;
  let lastSent: { key: string; name: string; droneId: number } | null = null;

  function previewOn() { return store.state.preview !== null; }
  function setPreview(on: boolean) {
    const v = app.validate(drafts.current);
    store.set({ preview: on && v.ok && v.recipe ? { recipe: v.recipe, label: drafts.current.name } : null });
  }

  function render() {
    const d = drafts.current;
    const v = app.validate(d);
    const focusId = (document.activeElement as HTMLElement | null)?.id;
    const caret = (document.activeElement as HTMLInputElement | null)?.selectionStart ?? null;
    body.innerHTML = ''; foot.innerHTML = '';

    // Drafts
    const chips = h('div', { class: 'drafts', role: 'group', 'aria-label': 'Drafts' },
      ...drafts.list.map(x => h('button', { class: 'chip', 'aria-pressed': String(x.id === d.id), onclick: () => { drafts.select(x.id); if (previewOn()) setPreview(true); } },
        h('span', { class: 'dot', style: { background: x.palette ? rgbToHex(x.palette[0]) : DEFAULTS[x.kind][0] } }), x.name, x.sent.length ? h('span', { class: 'hint' }, '·sent') : null)),
      h('button', { class: 'chip add', onclick: () => { drafts.add({ name: `Draft ${drafts.list.length + 1}`, kind: 'text', text: 'ENCORE', palette: null }); if (previewOn()) setPreview(true); } }, '+ New'));
    body.append(h('div', { class: 'field' }, h('span', { class: 'eyebrow' }, 'Drafts'), chips));

    // Stepper
    const stage = !v.ok ? 1 : !previewOn() ? 1 : 2;
    body.append(h('div', { class: 'stepper', 'aria-hidden': 'true' },
      h('span', { class: stage >= 1 ? 'on' : '' }, h('span', { class: 'n' }, '1')), 'Shape', h('span', { class: 'line' }),
      h('span', { class: previewOn() ? 'on' : '' }, h('span', { class: 'n' }, '2')), 'Preview', h('span', { class: 'line' }),
      h('span', { class: lastSent ? 'on' : '' }, h('span', { class: 'n' }, '3')), 'Transmit'));

    // Name
    const name = h('input', { class: 'input', id: 'cmp-name', value: d.name, maxlength: 24, 'aria-describedby': 'cmp-name-hint' }) as HTMLInputElement;
    name.addEventListener('input', () => drafts.update({ name: name.value }));
    body.append(h('div', { class: 'field' }, h('label', { for: 'cmp-name' }, 'Name'), name));

    // Type
    const kinds: [Draft['kind'], string, string][] = [['text', 'Text', icon.text], ['sphere', 'Sphere', icon.sphere], ['helix', 'Double helix', icon.helix]];
    const types = h('div', { class: 'types', role: 'radiogroup', 'aria-label': 'Formation type' },
      ...kinds.map(([k, label, ic]) => h('button', { class: 'type', role: 'radio', 'aria-checked': String(d.kind === k), onclick: () => { drafts.update({ kind: k, text: k === 'text' ? d.text || 'ENCORE' : d.text }); if (previewOn()) setPreview(true); } }, h('span', { html: ic }), label)));
    const future = h('div', { class: 'future-types' }, h('span', { class: 'tag later' }, 'Later'),
      ...['Point cloud', 'SVG outline', 'Parametric', 'Preset library', 'Light patterns'].map(t => h('span', { class: 'ft', title: `${t}: not in the Recipe contract yet. Needs a new Recipe kind via a [contract] PR.` }, t)));
    body.append(h('div', { class: 'field' }, h('span', { class: 'label' }, 'Formation'), types, future));

    // Text
    if (d.kind === 'text') {
      const txt = h('input', { class: 'input mono', id: 'cmp-text', value: d.text, maxlength: 16, 'aria-invalid': String(v.errors.some(e => e.includes('font') || e.includes('letter'))), 'aria-describedby': 'cmp-text-hint', autocapitalize: 'characters', spellcheck: 'false' }) as HTMLInputElement;
      txt.addEventListener('input', () => { drafts.update({ text: txt.value.toUpperCase() }); if (previewOn()) setPreview(true); });
      const cells = d.text.replace(/ /g, '').length;
      body.append(h('div', { class: 'field' }, h('label', { for: 'cmp-text' }, 'Text'), txt,
        h('div', { class: 'hint', id: 'cmp-text-hint' }, `5×7 bitmap font: A–Z, 0–9, space · ${d.text.length} chars${cells ? ` · ~${Math.round(session.params.n0 / cells)} drones per glyph` : ''}`),
        ...v.errors.map(e => h('div', { class: 'hint err', role: 'alert' }, '✕ ', e))));
    } else for (const e of v.errors) body.append(h('div', { class: 'hint err', role: 'alert' }, '✕ ', e));

    // Colour
    const pal = d.palette ?? DEFAULTS[d.kind].map(hexToRgb) as [RGB, RGB];
    const endpoint = (i: 0 | 1) => {
      const inp = h('input', { type: 'color', value: rgbToHex(pal[i]).toLowerCase(), 'aria-label': i ? 'End colour' : 'Start colour' }) as HTMLInputElement;
      const lab = h('label', { class: 'swatch-btn', style: { background: rgbToHex(pal[i]) }, title: i ? 'End colour (right edge)' : 'Start colour (left edge)' }, inp);
      // Live feedback while the system picker is open; commit (and re-render) only on change.
      inp.addEventListener('input', () => { lab.style.background = inp.value; });
      inp.addEventListener('change', () => { const np = [...pal] as [RGB, RGB]; np[i] = hexToRgb(inp.value); drafts.update({ palette: np }); if (previewOn()) setPreview(true); });
      return lab;
    };
    let target: 0 | 1 = 0;
    const swatches = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Suggested colours' }, ...SWATCHES.map(c => h('button', { class: 'sw', style: { background: c }, 'aria-label': `Use ${c}`, onclick: () => { const np = [...pal] as [RGB, RGB]; np[target] = hexToRgb(c); target = target ? 0 : 1; drafts.update({ palette: np }); if (previewOn()) setPreview(true); } })));
    body.append(h('div', { class: 'field' }, h('span', { class: 'label' }, 'Light · two-endpoint gradient across the formation'),
      h('div', { class: 'palette' }, endpoint(0), h('div', { class: 'grad', style: { background: `linear-gradient(90deg, ${rgbToHex(pal[0])}, ${rgbToHex(pal[1])})` } }), endpoint(1)),
      swatches,
      h('div', { class: 'hint' }, d.palette ? h('button', { class: 'btn ghost small', onclick: () => { drafts.update({ palette: null }); if (previewOn()) setPreview(true); } }, 'Use default palette') : 'Default palette from the score package. Swatches fill start, then end.')));

    // Preview thumbnail (front view, x/y) from expandRecipe itself
    const canvas = h('canvas', { class: 'thumb', width: 640, height: 216, role: 'img', 'aria-label': `Front-view preview of ${d.name}` }) as HTMLCanvasElement;
    if (v.ok && v.recipe) {
      const f = expandRecipe(v.recipe, session.params.n0, session.params);
      const g = canvas.getContext('2d')!;
      const w = f.bounds.max[0] - f.bounds.min[0], hgt = f.bounds.max[1] - f.bounds.min[1];
      const sc = Math.min(560 / Math.max(w, 1), 170 / Math.max(hgt, 1));
      for (const s of f.slots) {
        const x = 320 + (s.pos[0] - (f.bounds.min[0] + w / 2)) * sc, y = 108 - (s.pos[1] - (f.bounds.min[1] + hgt / 2)) * sc;
        g.fillStyle = rgbToHex(s.colour); g.globalAlpha = 0.9 - 0.5 * s.index / f.slots.length;
        g.beginPath(); g.arc(x, y, 4.2, 0, Math.PI * 2); g.fill();
      }
    }
    const pBtn = h('button', { class: 'btn small', 'aria-pressed': String(previewOn()), disabled: !v.ok, onclick: () => setPreview(!previewOn()) }, h('span', { html: icon.eye }), previewOn() ? 'Hide stage preview' : 'Preview in stage');
    body.append(h('div', { class: 'field' }, h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, h('span', { class: 'label', style: { flex: '1' } }, `Preview · ${session.params.n0} priority-ordered slots`), pBtn), canvas,
      h('div', { class: 'hint' }, 'Brighter dots are higher-priority slots. The stage preview is drawn locally and sends nothing.')));

    for (const w of v.warnings) body.append(h('div', { class: 'hint warn' }, '▲ ', w));

    // Transmit
    const sel = app.actions.selectedLive();
    const targetId = pickedDrone ?? sel;
    const snap = session.arms.encore.curr;
    const t = targetId !== null ? snap.drones[targetId] : null;
    const inJam = t ? snap.jams.some(j => (t.pos[0] - j.centre[0]) ** 2 + (t.pos[1] - j.centre[1]) ** 2 + (t.pos[2] - j.centre[2]) ** 2 <= j.radius ** 2) : false;
    const idInput = h('input', { class: 'input mono', id: 'cmp-target', inputmode: 'numeric', placeholder: 'id', value: targetId ?? '', 'aria-label': 'Target drone id' }) as HTMLInputElement;
    idInput.addEventListener('change', () => { const n = Number(idInput.value); pickedDrone = Number.isInteger(n) && idInput.value !== '' ? n : null; render(); });
    const pickBtn = h('button', { class: 'btn', onclick: async () => {
      const r = await app.actions.pick('inject', 'Click the drone that will receive the uplink');
      if (r?.droneId !== null && r?.droneId !== undefined) { pickedDrone = r.droneId; store.set({ selected: { id: r.droneId, arm: 'encore' } }); }
      render();
    } }, h('span', { html: icon.target }), 'Pick in stage');
    const status = h('div', { class: 'status-line' });
    if (t) {
      status.append(h('span', { class: t.alive ? 'ok' : 'no' }, t.alive ? 'alive' : 'dead'));
      status.append(h('span', { class: inJam ? 'bad' : 'ok' }, inJam ? 'inside a jam: receives the uplink, cannot relay until it leaves' : 'radio clear'));
      if (t.partitionSide !== null) status.append(h('span', { class: 'bad' }, `partition group ${t.partitionSide}: the score stays on this side`));
      status.append(h('span', {}, `holds score v${t.belief.version.issuedTick}:${t.belief.version.origin}`));
    } else status.append(h('span', { class: 'hint' }, 'Choose a drone: the uplink reaches only that one.'));
    const can = v.ok && t?.alive === true;
    const cmd = `inject --drone ${targetId ?? '<id>'} --draft ${d.id}`;
    foot.append(
      h('div', { class: 'sec-title' }, h('span', { class: 'eyebrow' }, 'Transmit'), h('span', { class: 'tag proto', title: 'INJECT_SCORE runs on the prototype engine; main rejects it until #14 lands it' }, 'proto engine')),
      h('div', { class: 'target-row' }, idInput, pickBtn), status,
      h('button', { class: 'btn primary', disabled: !can, onclick: () => {
        if (targetId === null) return;
        const r = app.actions.inject(targetId, d.id);
        if (r.ok && r.event.type === 'INJECT_SCORE') { lastSent = { key: `${r.event.score.version.issuedTick}:${r.event.score.version.origin}`, name: d.name, droneId: targetId }; store.set({ preview: null }); render(); }
      } }, h('span', { html: icon.inject }), targetId !== null ? `Inject “${d.name}” into drone ${targetId}` : 'Inject into one drone', h('kbd', {}, 'I')),
      h('div', { class: 'cmd-echo', title: 'The same action as a console command' }, h('span', {}, `› ${cmd}`)),
      h('div', { class: 'hint' }, 'Other drones learn the score only from delivered SCORE messages. The static baseline ignores injections — a capability difference, not a score.'));
    if (lastSent) foot.append(sentCard(lastSent));
    if (focusId) { const f = el.querySelector<HTMLInputElement>(`#${focusId}`); if (f) { f.focus(); if (caret !== null && 'setSelectionRange' in f) try { f.setSelectionRange(caret, caret); } catch { /* colour inputs */ } } }
  }

  const bar = h('div', { class: 'bar' });
  const barText = h('span', { class: 'mono hint' });
  function sentCard(s: { key: string; name: string; droneId: number }) {
    return h('div', { class: 'sent' }, h('div', { class: 'top' }, h('span', { class: 'dot', style: { width: '8px', height: '8px', borderRadius: '50%', background: app.palette.colour(s.key) } }), h('b', {}, `${s.name} · v${s.key}`), h('span', { class: 'hint', style: { marginLeft: 'auto' } }, `via drone ${s.droneId}`)), bar, barText,
      h('div', { style: { display: 'flex', gap: '6px' } }, h('button', { class: 'btn small', onclick: () => app.actions.lens('colour', 'belief') }, 'Show belief colours'), h('button', { class: 'btn small', onclick: () => app.surfaces.open('timeline') }, 'Open timeline')));
  }
  function tick() {
    if (!lastSent) return;
    const smp = session.arms.encore.sample;
    if (!smp) return;
    const n = smp.versions[lastSent.key] ?? 0;
    const share = smp.alive ? n / smp.alive : 0;
    bar.innerHTML = `<i style="width:${(share * 100).toFixed(1)}%;background:${app.palette.colour(lastSent.key)}"></i>`;
    barText.textContent = `adopted by ${n}/${smp.alive} live Encore drones · static: n/a (ignores uplinks)`;
  }

  drafts.onChange(() => { if (app.surfaces.isOpen('composer')) render(); });
  session.onReset(() => { lastSent = null; pickedDrone = null; if (app.surfaces.isOpen('composer')) render(); });
  store.subscribe((_s, changed) => { if (app.surfaces.isOpen('composer') && (changed.includes('selected') || changed.includes('preview'))) render(); });
  Object.assign(el, { render: render });
  Object.assign(el, { tick: tick });
  return el;
}
