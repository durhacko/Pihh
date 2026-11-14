// Console tray (FE-B2 #93; UI-04): prompt, history, completion with ghost text, and one typed event stream.
// A line is parsed and validated by the FE-B1 grammar (commands.ts), then dispatched through the SAME path as the
// buttons: control steps go to the one action controller (runControlPlan), inject goes through dispatchInject (shared
// with the Composer). Feedback separates the stages DESIGN §6.3 names, so "scheduled" is never shown as "done":
//   validated → scheduled (the controller accepted an EnvEvent for tick T) → applied (the world reached tick T, read
//   from the snapshot) → observed (a measurement from the observer's MetricsSample, e.g. adoption of a score).
// Events scheduled by other paths (buttons, keys) are reported in the same stream.
// No createPanel export: the shell mounts it with connectConsole(ctx).
import type { EnvEvent } from '../../contracts';
import { versionKey } from '../render/colourModes/belief';
import { readViewMode } from '../render/colourModes/viewMode';
import { complete, parse, type Lens, type Suggestion, type UiAction } from './commands';
import { adoption, cancelPendingPick, dispatchInject, draftFromRecipe, parseContext, runControlPlan, setPreview, validateDraft, type ComposeContext, type PlanOutcome, type SentRecord } from './Composer';
import { h } from './dom';
import { icon } from './icons';
import type { Surfaces } from './surfaces';

export type LineKind = 'input' | 'info' | 'help' | 'validated' | 'scheduled' | 'applied' | 'observed' | 'error' | 'later';
export interface ConsoleLine { kind: LineKind; text: string; tick: number | null }

/** Optional shell hooks. A command whose hook is missing says so; it is never dropped silently. */
export interface ConsoleHooks {
  /** Advance exactly one tick (the transport, #92). */
  step?(): void;
  /** Open the inspector on a drone of either arm (#91 connectInspector with { arm }). */
  inspect?(id: number, arm: 'encore' | 'static'): void;
  /** The scripted demo (FE-E, #94). Returns what to print. */
  demo?(action: 'run' | 'stop'): string;
}
export interface ConsoleContext extends ComposeContext {
  surfaces?: Surfaces;
  hooks?: ConsoleHooks;
}

/** The prompt's maximum length: did-you-mean is quadratic in the line, so cap it (PR #99 review). */
export const INPUT_MAX = 512;
const HISTORY_MAX = 200;
const MILESTONES = [0.25, 0.5, 0.9, 1];

function scheduledText(event: EnvEvent): string {
  const base = `${event.type} for tick ${event.tick}, in both worlds`;
  switch (event.type) {
    case 'KILL': return `${base} (${event.ids.length} drone${event.ids.length === 1 ? '' : 's'}: ${event.ids.slice(0, 12).join(', ')}${event.ids.length > 12 ? ', …' : ''})`;
    case 'JAM_ON': return `${base} (radius ${event.radius} m)`;
    case 'SET_LOSS': return `${base} (packet loss ${Math.round(event.loss * 100)} %)`;
    case 'INJECT_SCORE': return `${base} (v${versionKey(event.score.version)} into drone ${event.droneId} only; the static brain ignores uplinks)`;
    default: return base;
  }
}

/** The console without a DOM: feed it lines with run(), call poll() a few times a second, render what it prints. */
export function createConsoleEngine(ctx: ConsoleContext, print: (line: ConsoleLine) => void, onClear: () => void = () => {}) {
  const history: string[] = [];
  let reported = ctx.controller.getEventLog().length;   // events already logged before the console existed
  let pending: EnvEvent[] = [];                          // scheduled, waiting for their tick
  let watching: { sent: Pick<SentRecord, 'key' | 'tick' | 'droneId'>; first: boolean; next: number }[] = [];
  const tick = () => ctx.snapshots().encore.tick;
  const say = (kind: LineKind, text: string) => print({ kind, text, tick: kind === 'input' ? null : tick() });

  function track(events: readonly EnvEvent[], from: 'console' | 'controls') {
    for (const event of events) {
      say('scheduled', `${scheduledText(event)}${from === 'controls' ? ' · from the controls' : ''}`);
      pending.push(event);
      if (event.type === 'INJECT_SCORE') watching.push({ sent: { key: versionKey(event.score.version), tick: event.tick, droneId: event.droneId }, first: true, next: 0 });
    }
  }

  let lastTick = tick();
  const signature = (log: readonly EnvEvent[]) => (reported > 0 && log[reported - 1] ? JSON.stringify(log[reported - 1]) : '');
  let lastSeen = signature(ctx.controller.getEventLog());

  /**
   * Reports every log entry exactly once: the console's own (at `ownStart`, from runControlPlan) as the console's,
   * the rest as "from the controls". A reset is detected by the world clock going back or the log no longer holding
   * the last entry we reported, even if new events were scheduled since (a shorter log alone is not enough).
   */
  function sync(own: readonly EnvEvent[] = [], ownStart = -1) {
    const log = ctx.controller.getEventLog();
    const now = tick();
    if (log.length < reported || now < lastTick || signature(log) !== lastSeen) {
      if (pending.length || watching.length) say('info', 'The worlds were reset: pending events and adoption tracking cleared.');
      pending = []; watching = []; reported = 0;
    }
    for (let i = reported; i < log.length; i++) {
      if (ownStart >= 0 && i >= ownStart && i < ownStart + own.length) { if (i === ownStart) track(own, 'console'); continue; }
      track([log[i]], 'controls');
    }
    reported = log.length;
    lastTick = now;
    lastSeen = signature(log);
  }

  function report(outcome: PlanOutcome) {
    if (outcome.status === 'done') {
      if (outcome.events.length) sync(outcome.events, outcome.logStart);
      else say('info', outcome.message);
    } else say(outcome.status === 'failed' ? 'error' : 'info', outcome.message);
  }

  function appliedText(event: EnvEvent): string {
    const snapshot = ctx.snapshots().encore;
    switch (event.type) {
      case 'KILL': {
        const down = event.ids.filter(id => snapshot.drones[id] && !snapshot.drones[id].alive).length;
        return `KILL at t${event.tick}: ${down}/${event.ids.length} targeted drones are down in the Encore snapshot.`;
      }
      case 'JAM_ON': return `JAM_ON at t${event.tick}: ${snapshot.jams.some(jam => jam.id === event.id) ? `jam ${event.id} is active` : `jam ${event.id} is not in the snapshot`}.`;
      case 'JAM_OFF': return `JAM_OFF at t${event.tick}: ${snapshot.jams.some(jam => jam.id === event.id) ? `jam ${event.id} is still in the snapshot` : `jam ${event.id} is lifted`}.`;
      case 'PARTITION_ON': return `PARTITION_ON at t${event.tick}: ${snapshot.partitions.some(p => p.id === event.id) ? 'the partition is active' : 'no partition in the snapshot'}.`;
      case 'PARTITION_OFF': return `PARTITION_OFF at t${event.tick}: ${snapshot.partitions.some(p => p.id === event.id) ? 'the partition is still in the snapshot' : 'the partition is lifted'}.`;
      case 'SET_LOSS': return `SET_LOSS at t${event.tick}: packet loss ${Math.round(event.loss * 100)} % from this tick.`;
      case 'INJECT_SCORE': {
        const target = snapshot.drones[event.droneId];
        return target && (target.alive || (target.diedTick !== null && target.diedTick > event.tick))
          ? `INJECT_SCORE at t${event.tick}: the uplink is in drone ${event.droneId}'s inbox; nothing else was sent to any other drone.`
          : `INJECT_SCORE at t${event.tick}: drone ${event.droneId} was dead, so the world discarded the uplink.`;
      }
    }
  }

  /** Applied lines when a scheduled tick is reached; observed lines from observer samples. Call at a few Hz. */
  function poll() {
    sync();
    const now = tick();
    const due = pending.filter(event => event.tick <= now);
    pending = pending.filter(event => event.tick > now);
    for (const event of due) say('applied', appliedText(event));
    for (const watch of watching) {
      const reading = adoption(ctx.samples(), watch.sent);
      if (reading.state !== 'measured' || !reading.encore) continue;
      const { count, alive, share } = reading.encore;
      const staticPart = reading.static ? `static ${reading.static.count}/${reading.static.alive}` : 'static not sampled';
      if (watch.first) {
        watch.first = false;
        say('observed', `v${watch.sent.key} at t${reading.sampleTick}: Encore ${count}/${alive} live drones hold it · ${staticPart} (observer).`);
      }
      while (watch.next < MILESTONES.length && share >= MILESTONES[watch.next]) {
        say('observed', `v${watch.sent.key} reached ${Math.round(MILESTONES[watch.next] * 100)} % of live Encore drones (${count}/${alive}) at t${reading.sampleTick} (observer).`);
        watch.next++;
      }
    }
    watching = watching.filter(watch => watch.next < MILESTONES.length);
  }

  function surface(id: string, action: 'open' | 'close' | 'toggle'): boolean {
    try { ctx.surfaces?.[action](id); return !!ctx.surfaces; } catch { return false; }
  }

  function view(lens: Lens, on: boolean | undefined) {
    const mode = readViewMode();
    const lenses = ctx.store.state.lenses;
    if (lens === 'xray') {
      const want = on ?? !mode.xray;
      if (mode.xray !== want) { const result = ctx.controller.handle({ type: 'xray' }); if (!result.ok) return say('error', result.message); }
      ctx.store.lens('xray', want);
      return say('info', `X-ray ${want ? 'on' : 'off'} (visual only).`);
    }
    if (lens === 'beliefs' || lens === 'show') {
      // One colour mode: show colours OR belief colours. `view show off` therefore means belief colours on.
      const beliefs = lens === 'beliefs' ? on ?? !mode.beliefColours : !(on ?? mode.beliefColours);
      if (mode.beliefColours !== beliefs) { const result = ctx.controller.handle({ type: 'belief' }); if (!result.ok) return say('error', result.message); }
      ctx.store.lens('colour', beliefs ? 'belief' : 'show');
      return say('info', `Colours: ${beliefs ? 'belief (score version per drone)' : 'show (each drone’s own light)'} (visual only).`);
    }
    const want = on ?? !lenses[lens];
    ctx.store.lens(lens, want);
    return say('info', `${lens} ${want ? 'on' : 'off'} (visual only).`);
  }

  function ui(action: UiAction) {
    switch (action.type) {
      case 'inspect': {
        if (action.world === 'static') {
          if (!ctx.hooks?.inspect) return say('error', 'Inspecting the static arm is not available yet (#92).');
          ctx.hooks.inspect(action.id, 'static');
          return say('info', `Inspecting static drone ${action.id}${action.alive ? '' : ' (dead: its final step)'}.`);
        }
        cancelPendingPick(ctx);   // selecting here must not answer a pick that is still waiting for a click
        const result = ctx.controller.handle({ type: 'select', id: action.id });
        if (!result.ok) return say('error', result.message);
        ctx.hooks?.inspect?.(action.id, 'encore');
        surface('inspector', 'open');
        return say('info', `${result.message}${action.alive ? '' : ' It is dead: the inspector shows its final step.'}`);
      }
      case 'inspect-off': { cancelPendingPick(ctx); const result = ctx.controller.handle({ type: 'select', id: null }); surface('inspector', 'close'); return say(result.ok ? 'info' : 'error', result.message); }
      case 'view': return view(action.lens, action.on);
      case 'camera': ctx.store.set({ camera: null }); ctx.store.set({ camera: action.preset }); return say('info', `Camera: ${action.preset} (visual only).`);
      case 'compare': ctx.store.set({ view: action.mode === 'on' ? 'split' : action.mode === 'off' ? 'encore' : 'static' }); return say('info', `View: ${action.mode === 'on' ? 'split, Encore above static' : action.mode === 'off' ? 'Encore' : 'static'} (visual only).`);
      case 'metrics': case 'timeline': return surface(action.type, 'toggle') ? say('info', `Toggled ${action.type}.`) : say('error', `The ${action.type} surface is not available yet (#92).`);
      case 'clear': return onClear();
      case 'history': return say('info', history.slice(-20).map((line, i) => `${String(history.length - Math.min(20, history.length) + i + 1).padStart(3)}  ${line}`).join('\n') || 'No history yet.');
      case 'drafts': return say('info', ctx.drafts.list.map(draft => {
        const v = validateDraft(draft, ctx.params);
        return `${draft.id === ctx.drafts.current.id ? '*' : ' '} ${draft.id.padEnd(4)} ${draft.name.padEnd(14)} ${draft.kind}${draft.kind === 'text' ? ` "${draft.text}"` : ''}${v.ok ? '' : '  (invalid)'}${draft.sent.length ? `  sent as ${draft.sent.join(', ')}` : ''}`;
      }).join('\n'));
      case 'draft-use': {
        if (!ctx.drafts.select(action.id)) return say('error', `No draft "${action.id}". Type drafts.`);
        if (ctx.store.state.preview) setPreview(ctx, true);
        return say('info', `Draft ${action.id} “${ctx.drafts.current.name}” is current.`);
      }
      case 'preview': {
        const v = setPreview(ctx, action.on);
        if (action.on && !v.ok) return say('error', `Cannot preview “${ctx.drafts.current.name}”: ${v.errors[0]}`);
        return say('info', action.on ? `Preview on: “${ctx.drafts.current.name}” drawn locally over a dimmed swarm. Nothing was sent.` : 'Preview off.');
      }
      case 'demo-run': case 'demo-stop':
        return ctx.hooks?.demo ? say('info', ctx.hooks.demo(action.type === 'demo-run' ? 'run' : 'stop')) : say('error', 'The scripted demo is not available yet (#94).');
    }
  }

  async function run(raw: string): Promise<void> {
    const line = raw.trim();
    if (!line) return;
    say('input', line.slice(0, INPUT_MAX));
    if (line.length > INPUT_MAX) return say('error', `Commands are at most ${INPUT_MAX} characters.`);
    history.push(line);
    if (history.length > HISTORY_MAX) history.shift();
    sync();   // events from other paths first, so the stream stays in order
    const parsed = parse(line, parseContext(ctx));
    if (!parsed.ok) return say('error', parsed.usage ? `${parsed.error}\nUsage: ${parsed.usage}` : parsed.error);
    const intent = parsed.intent;
    switch (intent.kind) {
      case 'help': return say('help', intent.text);
      case 'planned': return say('later', intent.message);
      case 'step':
        if (!ctx.hooks?.step) return say('error', 'step is not available yet (#92).');
        ctx.hooks.step();
        return say('info', `Stepped to tick ${tick()}.`);
      case 'draft': {
        const draft = ctx.drafts.add(draftFromRecipe(intent.name, intent.recipe));
        const v = validateDraft(draft, ctx.params);
        if (!v.ok) return say('error', `Draft ${draft.id} “${draft.name}” was created but is not valid: ${v.errors[0]}`);
        if (ctx.store.state.preview) setPreview(ctx, true);
        return say('validated', `Draft ${draft.id} “${draft.name}” created and made current. Nothing was sent: try preview on, then inject --pick.`);
      }
      case 'ui': return ui(intent.ui);
      case 'inject': {
        // The draft is part of the command: an invalid one is reported as an error, never as "validated".
        const draft = intent.draftId === null ? ctx.drafts.current : ctx.drafts.get(intent.draftId);
        if (!draft) return say('error', `No draft "${intent.draftId}". Type drafts.`);
        const v = validateDraft(draft, ctx.params);
        if (!v.ok) return say('error', `Draft ${draft.id} “${draft.name}” is not valid: ${v.errors[0]} Nothing was sent.`);
        say('validated', `inject: draft ${draft.id} “${draft.name}” into ${intent.pick ? 'a picked drone' : intent.steps.length ? `drone ${(intent.steps[0] as { id: number }).id}` : 'the selected drone'}.`);
        if (intent.pick) say('info', `${intent.pick} (Esc cancels).`);
        return report(await dispatchInject(ctx, intent));
      }
      case 'control': {
        say('validated', `${intent.command}: ${intent.steps.map(step => step.type).join(' → ') || 'pick'}${intent.pick ? ' (after a pick)' : ''}.`);
        if (intent.pick) say('info', `${intent.pick} (Esc cancels).`);
        return report(await runControlPlan(ctx, intent));
      }
    }
  }

  return {
    run, poll,
    history: () => [...history],
    complete: (line: string): Suggestion[] => complete(line, parseContext(ctx)),
  };
}
export type ConsoleEngine = ReturnType<typeof createConsoleEngine>;

// ---------------------------------------------------------------------------------------------- DOM

const KIND_LABEL: Record<LineKind, string> = { input: '›', info: 'info', help: 'help', validated: 'validated', scheduled: 'scheduled', applied: 'applied', observed: 'observed', error: 'error', later: 'later' };

export interface ConsoleHandle { el: HTMLElement; engine: ConsoleEngine; open(): void; type(line: string): Promise<void>; dispose(): void }

/** Mounts the console tray in ctx.host (the app root). With ctx.surfaces it registers as the 'console' tray. */
export function connectConsole(input: ConsoleContext & { host: HTMLElement }): ConsoleHandle {
  const ctx = { ...input, events: input.events ?? input.host };
  const out = h('div', { class: 'out', role: 'log', 'aria-live': 'polite', 'aria-label': 'Console output and simulation events' });
  const field = h('input', { 'aria-label': 'Command', autocomplete: 'off', spellcheck: 'false', maxlength: INPUT_MAX, placeholder: 'Type a command: help, form text "DURHACK", inject --pick', role: 'combobox', 'aria-controls': 'cmd-suggest', 'aria-expanded': 'false', 'aria-autocomplete': 'list' });
  const ghost = h('div', { class: 'ghost', 'aria-hidden': 'true' });
  const list = h('ul', { class: 'suggest surface', role: 'listbox', id: 'cmd-suggest', hidden: true });
  const tallBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Expand console', html: icon.expand });
  const closeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close console', html: icon.close });
  const el = h('section', { class: 'tray console surface chrome', 'aria-label': 'Console' },
    h('div', { class: 'tray-head' }, h('span', { class: 'eyebrow' }, 'Console'),
      h('span', { class: 'hint' }, 'Commands are validated, then scheduled as simulation events. Results arrive as ', h('b', {}, 'applied'), ' and ', h('b', {}, 'observed'), ' lines.'),
      h('span', { class: 'grow' }), tallBtn, closeBtn),
    out, h('div', { class: 'prompt' }, h('span', { class: 'ps' }, 'encore ›'), h('div', { class: 'wrap' }, ghost, field), list));
  ctx.host.append(el);
  if (ctx.surfaces) ctx.surfaces.register({ id: 'console', kind: 'tray', el, focusOnOpen: () => field });
  const close = () => { if (ctx.surfaces?.isOpen('console')) ctx.surfaces.close('console'); else el.hidden = true; };
  tallBtn.addEventListener('click', () => el.classList.toggle('tall'));
  closeBtn.addEventListener('click', close);

  function printLine(line: ConsoleLine) {
    const row = h('div', { class: `line k-${line.kind}` },
      h('span', { class: 'tk' }, line.tick === null ? '' : `t${line.tick}`),
      h('span', { class: 'kd' }, KIND_LABEL[line.kind]),
      h('span', { class: 'tx', style: { whiteSpace: 'pre-wrap' } }, line.text));   // text only: console input is never HTML
    const stick = out.scrollTop + out.clientHeight >= out.scrollHeight - 8;
    out.append(row);
    while (out.childElementCount > 500) out.firstElementChild?.remove();
    if (stick) out.scrollTop = out.scrollHeight;
  }
  const engine = createConsoleEngine(ctx, printLine, () => out.replaceChildren());
  printLine({ kind: 'info', text: 'Encore console. Type help for the commands. Tab completes, ↑ ↓ recall history.', tick: null });

  let suggestions: Suggestion[] = [];
  let active = 0;
  let recall = -1;
  /** The text before the caret: commands.complete completes only that; the rest of the line is kept. */
  const caret = () => field.selectionStart ?? field.value.length;
  function hideSuggestions() {
    suggestions = []; list.hidden = true; ghost.textContent = '';
    field.setAttribute('aria-expanded', 'false'); field.removeAttribute('aria-activedescendant');
  }
  function refresh() {
    const head = field.value.slice(0, caret());
    suggestions = head.trim() && document.activeElement === field && recall < 0 ? engine.complete(head) : [];
    active = Math.min(active, Math.max(0, suggestions.length - 1));
    list.replaceChildren(...suggestions.map((s, i) => {
      const item = h('li', { role: 'option', id: `sg-${i}`, 'aria-selected': String(i === active) },
        h('span', { class: 'c' }, s.label), h('span', { class: 'd' }, s.desc),
        s.status === 'later' ? h('span', { class: 'tag later' }, 'later') : s.status === 'proto' ? h('span', { class: 'tag proto' }, 'proto') : h('span', {}));
      item.addEventListener('mousedown', event => { event.preventDefault(); accept(i); });
      return item;
    }));
    const show = suggestions.length > 0;
    list.hidden = !show;
    field.setAttribute('aria-expanded', String(show));
    if (show) field.setAttribute('aria-activedescendant', `sg-${active}`); else field.removeAttribute('aria-activedescendant');
    const first = suggestions[active];
    ghost.textContent = first && caret() === field.value.length && first.insert.startsWith(field.value) ? first.insert : '';
  }
  function accept(i: number) {
    const s = suggestions[i];
    if (!s) return;
    const tail = field.value.slice(caret()).replace(/^\S*\s*/, '');   // drop the rest of the word being completed
    field.value = `${s.insert}${tail}`.slice(0, INPUT_MAX);
    const at = Math.min(s.insert.length, field.value.length);
    field.setSelectionRange(at, at);
    active = 0; refresh(); field.focus();
  }
  async function submit(line: string) {
    field.value = ''; recall = -1; refresh();
    await engine.run(line);
  }
  field.addEventListener('input', () => { recall = -1; active = 0; refresh(); });   // typing leaves history mode
  field.addEventListener('focus', refresh);
  field.addEventListener('blur', hideSuggestions);
  field.addEventListener('keydown', event => {
    event.stopPropagation();   // typing never reaches the global shortcuts
    const history = engine.history();
    const listOpen = !list.hidden && suggestions.length > 0;
    if (event.key === 'Enter') { event.preventDefault(); void submit(field.value); }
    else if (event.key === 'Tab') { if (listOpen) { event.preventDefault(); accept(active); } }   // a dismissed list lets Tab move focus
    // While recalling history (recall >= 0) the arrows keep walking history; once the user types they move the list.
    else if (event.key === 'ArrowDown' && listOpen && recall < 0) { event.preventDefault(); active = (active + 1) % suggestions.length; refresh(); }
    else if (event.key === 'ArrowUp' && listOpen && recall < 0 && field.value) { event.preventDefault(); active = (active - 1 + suggestions.length) % suggestions.length; refresh(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); if (!history.length) return; recall = recall < 0 ? history.length - 1 : Math.max(0, recall - 1); field.value = history[recall]; hideSuggestions(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); if (recall < 0) return; recall++; field.value = recall >= history.length ? '' : history[recall]; if (recall >= history.length) { recall = -1; refresh(); } else hideSuggestions(); }
    else if (event.key === 'Escape') {
      event.preventDefault();
      if (ctx.store.state.pick) ctx.store.state.pick.resolve(null);
      else if (!list.hidden) hideSuggestions();
      else if (field.value) { field.value = ''; refresh(); }
      else close();
    } else if (event.key === 'l' && event.ctrlKey) { event.preventDefault(); out.replaceChildren(); }
  });
  field.addEventListener('keyup', event => {
    event.stopPropagation();
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) && recall < 0) refresh();   // the caret moved
  });
  field.addEventListener('click', () => { if (recall < 0) refresh(); });
  const timer = setInterval(() => engine.poll(), 250);
  return {
    el, engine,
    open() { if (ctx.surfaces) ctx.surfaces.open('console'); else { el.hidden = false; field.focus(); } },
    type: submit,
    dispose() { clearInterval(timer); el.remove(); },
  };
}
