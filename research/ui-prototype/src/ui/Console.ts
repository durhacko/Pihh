// Console tray: the command line and the unified event stream.
// Every session log entry (accepted / applied / observed / error) lands here, so a command's acceptance and the
// simulation's later reaction are visibly different lines.
import type { LogEntry } from '../engine/session';
import type { App } from './app';
import { complete, execute, type Out, type Suggestion } from './commands';
import { esc, h } from './dom';
import { icon } from './icons';

const KIND_LABEL: Record<string, string> = { input: '›', accepted: 'accepted', applied: 'applied', observed: 'observed', error: 'error', info: 'info', future: 'later' };

export function createConsole(app: App): HTMLElement {
  const out = h('div', { class: 'out', role: 'log', 'aria-live': 'polite', 'aria-label': 'Console output and simulation events' });
  const input = h('input', { 'aria-label': 'Command', autocomplete: 'off', spellcheck: 'false', placeholder: 'Type a command — try  help,  form text "DURHACK",  fault jam --pick' }) as HTMLInputElement;
  const ghost = h('div', { class: 'ghost', 'aria-hidden': 'true' });
  const list = h('ul', { class: 'suggest surface', role: 'listbox', id: 'cmd-suggest', hidden: true });
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-controls', 'cmd-suggest'); input.setAttribute('aria-expanded', 'false');
  const tallBtn = h('button', { class: 'icon-btn', 'aria-label': 'Expand console', html: icon.expand });
  const closeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Close console', html: icon.close });
  const el = h('section', { class: 'tray console surface chrome', 'aria-label': 'Console' },
    h('div', { class: 'tray-head' }, h('span', { class: 'eyebrow' }, 'Console'), h('span', { class: 'hint' }, 'Commands are validated, then scheduled as simulation events. Results arrive as ', h('b', {}, 'applied'), ' / ', h('b', {}, 'observed'), ' lines.'), h('span', { class: 'grow' }), tallBtn, closeBtn),
    out,
    h('div', { class: 'prompt' }, h('span', { class: 'ps' }, 'encore ›'), h('div', { class: 'wrap' }, ghost, input), list),
  );
  tallBtn.addEventListener('click', () => el.classList.toggle('tall'));
  closeBtn.addEventListener('click', () => app.surfaces.close('console'));

  const history: string[] = [];
  let hIndex = -1;
  let sugg: Suggestion[] = [];
  let active = 0;

  function print(kind: string, text: string, tick: number | null, tag?: string) {
    const row = h('div', { class: `line k-${kind}` },
      h('span', { class: 'tk' }, tick === null ? '' : `t${tick}`),
      h('span', { class: 'kd' }, KIND_LABEL[kind] ?? kind),
      h('span', { class: 'tx', html: esc(text) + (tag === 'proto' ? '<span class="tag proto" title="Runs on the prototype engine only; main rejects this event today">proto</span>' : tag === 'later' ? '<span class="tag later">later</span>' : '') }));
    const stick = out.scrollTop + out.clientHeight >= out.scrollHeight - 8;
    out.append(row);
    while (out.childElementCount > 500) out.firstElementChild?.remove();
    if (stick) out.scrollTop = out.scrollHeight;
  }
  const printOut = (o: Out) => print(o.kind, o.text, o.kind === 'input' ? null : app.session.tick, o.tag);
  const onLog = (e: LogEntry) => print(e.kind, e.text, e.tick, e.support === 'prototype' ? 'proto' : undefined);
  app.session.onLog(onLog);
  print('info', 'Encore console. Type help for the command list. Tab completes, ↑ ↓ recall history.', null);

  function refresh() {
    sugg = input.value.trim() || document.activeElement === input ? complete(input.value, app) : [];
    active = Math.min(active, Math.max(0, sugg.length - 1));
    list.innerHTML = '';
    sugg.forEach((s, i) => {
      const li = h('li', { role: 'option', id: `sg-${i}`, 'aria-selected': String(i === active) },
        h('span', { class: 'c' }, s.label), h('span', { class: 'd' }, s.desc),
        s.status === 'later' ? h('span', { class: 'tag later' }, 'later') : s.status === 'proto' ? h('span', { class: 'tag proto' }, 'proto') : h('span', {}));
      li.addEventListener('mousedown', e => { e.preventDefault(); accept(i); });
      list.append(li);
    });
    const show = sugg.length > 0 && input.value.length > 0;
    list.hidden = !show;
    input.setAttribute('aria-expanded', String(show));
    if (show) input.setAttribute('aria-activedescendant', `sg-${active}`); else input.removeAttribute('aria-activedescendant');
    const first = sugg[active];
    ghost.textContent = first && first.insert.startsWith(input.value) ? first.insert : '';
  }
  function accept(i: number) {
    const s = sugg[i];
    if (!s) return;
    input.value = s.insert; active = 0; refresh(); input.focus();
  }
  async function run() {
    const line = input.value.trim();
    input.value = ''; refresh();
    if (!line) return;
    history.push(line); hIndex = -1;
    printOut({ kind: 'input', text: line });
    if (line === 'clear') { out.innerHTML = ''; return; }
    if (line === 'history') { printOut({ kind: 'info', text: history.slice(-20).map((l, i) => `${String(i + 1).padStart(3)}  ${l}`).join('\n') }); return; }
    await execute(line, app, printOut);
  }
  input.addEventListener('input', () => { active = 0; refresh(); });
  input.addEventListener('focus', refresh);
  input.addEventListener('blur', () => { list.hidden = true; ghost.textContent = ''; });
  input.addEventListener('keydown', e => {
    e.stopPropagation();   // typing never reaches the global shortcuts
    if (e.key === 'Enter') { e.preventDefault(); void run(); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      if (sugg.length) accept(active);
    } else if (e.key === 'ArrowDown' && !list.hidden) { e.preventDefault(); active = (active + 1) % sugg.length; refresh(); }
    else if (e.key === 'ArrowUp' && !list.hidden && input.value) { e.preventDefault(); active = (active - 1 + sugg.length) % sugg.length; refresh(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (!history.length) return; hIndex = hIndex < 0 ? history.length - 1 : Math.max(0, hIndex - 1); input.value = history[hIndex]; refresh(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (hIndex < 0) return; hIndex++; if (hIndex >= history.length) { hIndex = -1; input.value = ''; } else input.value = history[hIndex]; refresh(); }
    else if (e.key === 'Escape') {
      e.preventDefault();
      if (!list.hidden) { list.hidden = true; ghost.textContent = ''; }
      else if (input.value) { input.value = ''; refresh(); }
      else app.surfaces.close('console');
    } else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); out.innerHTML = ''; }
  });
  input.addEventListener('keyup', e => e.stopPropagation());
  Object.assign(el, { focusInput: () => input.focus() });
  Object.assign(el, { type: async (line: string) => { input.value = line; await run(); } });
  return el;
}
