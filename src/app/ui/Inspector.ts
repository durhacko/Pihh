// Drone inspector (FE-C #91, absorbs #29, UI-07). Click a drone: see only what that drone knows.
// ISOLATION (experience doc §6, DESIGN §8.3): the agent section is built ONLY from World.inspect(id) and that drone's
// Belief, handed in as an AgentView. The hatched observer box is fed by a separate, pre-labelled ObserverTruth built
// outside this module (ui/inspectorTruth.ts). This module never imports WorldSnapshot or src/agent
// (tests/app/stage/isolation.test.ts). Without connectInspector() it renders nothing.
import { OPERATOR } from '../../contracts';
import type { AgentInput, AgentOutput, Belief, SlotStatus } from '../../contracts';
import { versionColour, versionKey } from '../render/colourModes/belief';
import { readViewMode } from '../render/colourModes/viewMode';
import type { PanelContext } from './index';
import { peerDiff, referenceTSuspect, type PeerTruth } from './peerDiff';

export type InspectorArm = 'encore' | 'static';
/** World.inspect(id): that drone's last step, deep-copied by the world. */
export interface InspectResult { input: AgentInput; output: AgentOutput; state: unknown }
/** Everything the agent section may read: the drone's own last step and its own Belief. */
export interface AgentView { id: number; inspect: InspectResult | null; belief: Belief }
/** Ground truth the drone cannot see. Pre-labelled, so it can never be mistaken for agent knowledge. */
export interface ObserverTruth {
  readonly source: 'observer';
  id: number; tick: number;
  alive: boolean; diedTick: number | null;
  believedSlot: number;
  /** Does the observer's reference slot `believedSlot` sit at this drone's belief.target? false when the drone flies
   *  a different score version than the observer's reference; null before the first slot reading. */
  sameFormation: boolean | null;
  believedSlotStatus: SlotStatus | null;   // Observer.slotStatus for that slot; null unless sameFormation is true
  slotStatusTick: number | null;           // the tick that reading was computed for (it is throttled)
  jammedBy: string[];
  partitionSide: 0 | 1 | null;
  inRadioRange: { live: number; dead: number };
  /** P2-WP-09: every other drone by id, for the peer diff. Optional: absent truth hides the section. */
  peers?: PeerTruth;
}
export interface InspectorSource {
  agent(id: number, arm: InspectorArm): AgentView | null;
  truth(id: number, arm: InspectorArm): ObserverTruth | null;
  /** Optional: lets the panel's Close button clear the selection through the controls (never edits a world). */
  select?(id: number | null): void;
}

let connection: { source: InspectorSource; arm: InspectorArm } | null = null;
const listeners = new Set<() => void>();

/** The one seam to the app (main.ts): which data callbacks to use, and which arm to show (default Encore). */
export function connectInspector(source: InspectorSource | null, options: { arm?: InspectorArm } = {}): void {
  connection = source ? { source, arm: options.arm ?? 'encore' } : null;
  for (const listener of listeners) listener();
}
export function inspectorArm(): InspectorArm | null { return connection?.arm ?? null; }

// ---------- Pure view model (tested headless) ----------

export interface Row { label: string; value: string }

function num(value: number, digits = 1): string { return Number.isFinite(value) ? value.toFixed(digits) : '—'; }
function vec(value: readonly number[], digits = 1): string { return `(${value.map(v => num(v, digits)).join(', ')})`; }
function length(value: readonly number[]): number { return Math.hypot(...value); }

export function versionLabel(version: Belief['version']): string {
  return `v${versionKey(version)}${version.origin === OPERATOR ? ' (preloaded)' : ` (uplink via #${version.origin})`}`;
}

/** Agent knowledge rows: Belief and inspect() only. */
export function agentRows(view: AgentView): Row[] {
  const { belief, inspect } = view;
  const rows: Row[] = [
    { label: 'Slot', value: `${belief.slot} · held since t${belief.heldSince}` },
    { label: 'Flying to', value: `${vec(belief.target)}${inspect ? ` · ${num(length(inspect.input.pos.map((p, i) => p - belief.target[i])))} m away` : ''}` },
    { label: 'Score version', value: versionLabel(belief.version) },
    { label: 'Healing', value: belief.canHeal ? 'eligible (canHeal)' : 'not eligible' },
    { label: 'Claim', value: belief.claiming === null ? 'none' : `claiming slot ${belief.claiming}` },
    { label: 'Radio', value: `${belief.deaf ? 'DEAF · ' : ''}${belief.peersKnown} peers heard recently` },
  ];
  if (!inspect) return [...rows, { label: 'Last step', value: 'No step recorded yet' }];
  const { input, output } = inspect;
  const count = (messages: readonly { type: string }[]) => {
    const hb = messages.filter(message => message.type === 'HB').length;
    return `${hb} HB · ${messages.length - hb} SCORE`;
  };
  const nearest = input.sensed.reduce((best, sensed) => Math.min(best, length(sensed.rel)), Infinity);
  return [...rows,
    { label: 'Last step', value: `tick ${input.tick}` },
    { label: 'Inbox (last step)', value: count(input.inbox) },
    { label: 'Sent (last step)', value: count(output.outbox) },
    { label: 'Senses', value: `${input.sensed.length} drones · nearest ${Number.isFinite(nearest) ? `${num(nearest, 2)} m` : '—'}` },
    { label: 'Own body', value: `${vec(input.pos)} · ${num(length(input.vel))} m/s` },
    { label: 'Output accel', value: vec(output.accel, 2) },
  ];
}

/** The drone's own decision log, newest first. */
export function decisionLog(view: AgentView): string[] { return [...view.belief.log].reverse(); }

// Observer.slotStatus semantics (src/observer/measure.ts): "occupied" means SOME live drone is within rOcc of it.
const STATUS_LABEL: Record<SlotStatus, string> = { occupied: 'occupied by a live drone', inTransit: 'in transit (one claimant)', vacant: 'vacant', contested: 'contested (2+ claimants)' };

/** Observer box rows: the pre-labelled truth object only. */
export function truthRows(truth: ObserverTruth): Row[] {
  // A dead drone's belief froze at death. While its frozen target still IS the reference slot, the observer's status of
  // that slot is still true (whether a live drone holds it now) and is shown with when the target froze. Once the score
  // moves on, the old target no longer matches, which would otherwise read as "flies a different score": it flies
  // nothing, and the row says so.
  const slotStatus = (status: SlotStatus) => `${STATUS_LABEL[status]}${truth.slotStatusTick === null ? '' : ` (t${truth.slotStatusTick})`}`;
  const died = `t${truth.diedTick ?? '?'}`;
  const status = !truth.alive
    ? truth.sameFormation && truth.believedSlotStatus !== null
      ? `${slotStatus(truth.believedSlotStatus)}; its target frozen since ${died}`
      : `dead since ${died}; target frozen`
    : truth.sameFormation === null || (truth.sameFormation && truth.believedSlotStatus === null)
      ? 'not sampled yet'
      : !truth.sameFormation || truth.believedSlotStatus === null
        ? 'not comparable: it flies a different score than the observer reference'
        : slotStatus(truth.believedSlotStatus);
  return [
    { label: 'True state', value: truth.alive ? 'alive' : `dead since t${truth.diedTick ?? '?'}` },
    { label: `Slot ${truth.believedSlot}, per observer`, value: status },
    { label: 'Jammed now', value: truth.jammedBy.length ? `yes (${truth.jammedBy.join(', ')})` : 'no' },
    { label: 'Partition group', value: truth.partitionSide === null ? 'none' : `group ${truth.partitionSide}` },
    { label: 'In radio range', value: `${truth.inRadioRange.live} live · ${truth.inRadioRange.dead} dead` },
  ];
}

export interface PeerSection {
  /** The drone's own tSuspect, shown as a reference value only; never compared with any age here. */
  reference: string;
  rows: { id: string; heard: string; truth: string }[];
}

/**
 * P2-WP-09 peer diff rows: each peer's "last heard" age from the drone's own state, beside the observer's truth label.
 * No label is derived from brain rules (P2-ADR-07). null hides the section: no step yet, no peer truth, or no
 * well-formed peer table in the state (the static brain has none). Ages are in ticks, the drone's own clock unit: the
 * contract allowlist of isolation.test.ts keeps DT out of the Inspector's import graph.
 */
export function peerSection(view: AgentView | null, truth: ObserverTruth | null): PeerSection | null {
  if (!view?.inspect || !truth?.peers) return null;
  const rows = peerDiff(view.inspect.state, truth.peers, view.inspect.input.tick);
  if (rows === null) return null;
  const tSuspect = referenceTSuspect(view.inspect.state);
  return {
    reference: tSuspect === null ? 'tSuspect not in state' : `its tSuspect: ${tSuspect} ticks (reference)`,
    rows: rows.map(row => ({
      id: `#${row.id}`,
      heard: row.heardAgo === null ? 'no entry' : `${row.heardAgo} ticks ago`,
      truth: row.truth,
    })),
  };
}

export interface TreeNode { key: string; summary: string; children?: TreeNode[]; more?: number }

/** A generic tree of the brain's private state: no field names hard-coded, bounded in width and depth. */
export function toTree(value: unknown, key = 'state', maxEntries = 60, maxDepth = 8): TreeNode {
  if (value === null || typeof value !== 'object') return { key, summary: value === undefined ? 'undefined' : JSON.stringify(value) };
  const entries: [string, unknown][] = Array.isArray(value) ? value.map((item, i) => [String(i), item]) : Object.entries(value as Record<string, unknown>);
  const summary = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;
  if (maxDepth <= 0) return { key, summary: `${summary} …` };
  const shown = entries.slice(0, maxEntries);
  return { key, summary, children: shown.map(([k, v]) => toTree(v, k, maxEntries, maxDepth - 1)), more: entries.length - shown.length };
}

// ---------- DOM panel ----------

const STYLE = `
.encore-inspector{position:absolute;right:24px;top:120px;width:min(320px,calc(100vw - 48px));max-height:calc(100dvh - 260px);overflow:auto;overscroll-behavior:contain;border:1px solid #24404f;border-radius:10px;background:#06121de8;box-shadow:0 15px 40px #0005;color:#c4d9e2;font:12px/1.5 system-ui;z-index:4}
.encore-inspector[hidden]{display:none}
.encore-inspector .head{display:flex;align-items:center;gap:8px;padding:10px 10px 8px 14px;border-bottom:1px solid #24404f}
.encore-inspector .eyebrow{font-size:10.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#7f99a6}
.encore-inspector .id{font:600 15px ui-monospace,Menlo,monospace;color:#e2eef3}
.encore-inspector .pill{font-size:10px;letter-spacing:.1em;padding:1px 6px;border:1px solid #38505b;border-radius:999px;color:#a9bec8}
.encore-inspector .pill.deaf{border-color:#e2eef3;color:#e2eef3}.encore-inspector .pill.dead{border-style:dashed}
.encore-inspector .spacer{flex:1}
.encore-inspector button{font:inherit;width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:#a9bec8;cursor:pointer;font-size:16px}
.encore-inspector button:hover{background:#d6ecf31a;color:#e2eef3}.encore-inspector button:focus-visible,.encore-inspector summary:focus-visible{outline:2px solid #d6ecf3;outline-offset:2px}
.encore-inspector .body{display:grid;gap:14px;padding:12px 14px 14px}
.encore-inspector .notice{color:#a9bec8}.encore-inspector .notice:empty{display:none}
.encore-inspector .sec-title{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:6px}
.encore-inspector .src,.encore-inspector .hint{font-size:11px;color:#7f99a6}
.encore-inspector dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:3px 12px;margin:0}
.encore-inspector dt{color:#7f99a6}.encore-inspector dd{margin:0;text-align:right;overflow-wrap:anywhere;font-family:ui-monospace,Menlo,monospace;font-size:11.5px;font-variant-numeric:tabular-nums}
.encore-inspector .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
.encore-inspector .label{font-size:11.5px;color:#a9bec8;margin:10px 0 4px}
.encore-inspector ol{margin:0;padding:0;list-style:none;max-height:140px;overflow:auto;font:11px/1.6 ui-monospace,Menlo,monospace;color:#a9bec8}
.encore-inspector li{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.encore-inspector details summary{cursor:pointer;color:#a9bec8}
.encore-inspector .tree{max-height:220px;overflow:auto;margin-top:6px;font:11px/1.6 ui-monospace,Menlo,monospace;color:#a9bec8}
.encore-inspector .tree details{padding-left:12px}.encore-inspector .tree .leaf{padding-left:12px;white-space:nowrap}
.encore-inspector .observer{padding:10px 12px;border:1px dashed #3a5260;border-radius:8px;background:repeating-linear-gradient(135deg,#8fa3ad14 0 6px,transparent 6px 12px)}
.encore-inspector .peers-scroll{max-height:220px;overflow:auto}
.encore-inspector .peers{width:100%;table-layout:fixed;border-collapse:collapse;font:10.5px/1.5 ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums}
.encore-inspector .peers col.id{width:3.2em}.encore-inspector .peers col.heard{width:7.8em}
.encore-inspector .peers td.truth{font:10.5px/1.5 system-ui}
.encore-inspector .peers th{position:sticky;top:0;background:#06121d;text-align:left;vertical-align:bottom;font:600 10px/1.4 system-ui;letter-spacing:.02em;color:#7f99a6;padding:2px 4px}
.encore-inspector .peers td{padding:1px 4px;color:#c4d9e2;overflow-wrap:anywhere}
.encore-inspector .peers td.truth,.encore-inspector .peers th.truth{border-left:1px dashed #3a5260;background:repeating-linear-gradient(135deg,#8fa3ad14 0 6px,transparent 6px 12px);color:#a9bec8}
.encore-inspector .peers th.truth{background:repeating-linear-gradient(135deg,#8fa3ad14 0 6px,transparent 6px 12px),#06121d}
.encore-inspector .tag{font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#a9bec8;padding:1px 6px;border:1px solid #4a6270;border-radius:4px}
`;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fillRows(list: HTMLDListElement, rows: Row[]): void {
  list.replaceChildren(...rows.flatMap(row => [element('dt', undefined, row.label), element('dd', undefined, row.value)]));
}

/** Rebuilds keep whatever the user expanded: each <details> carries its path, and open paths are reopened. */
function renderTree(node: TreeNode, openPaths: ReadonlySet<string>, path = node.key): HTMLElement {
  if (!node.children) {
    const leaf = element('div', 'leaf');
    leaf.append(element('b', undefined, `${node.key}: `), node.summary);
    return leaf;
  }
  const details = element('details');
  details.dataset.path = path;
  details.open = openPaths.has(path);
  details.append(element('summary', undefined, `${node.key} ${node.summary}`), ...node.children.map(child => renderTree(child, openPaths, `${path}/${child.key}`)));
  if (node.more) details.append(element('div', 'leaf', `… ${node.more} more`));
  return details;
}

const REFRESH_MS = 250;        // DESIGN §8.3: the inspector refreshes at 4 Hz...
const HOVER_REFRESH_MS = 1000; // ...and at 1 Hz while hovered, so text can be selected
const TREE_REFRESH_MS = 1000;  // the raw tree is rebuilt at most once a second while open

export function createPanel({ host }: PanelContext) {
  const panel = element('aside', 'encore-inspector');
  panel.setAttribute('aria-label', 'Drone inspector');
  panel.hidden = true;
  panel.innerHTML = `<style>${STYLE}</style>
    <header class="head"><span class="eyebrow">Drone</span><span class="id" data-id></span><span data-pills style="display:flex;gap:4px"></span><span class="spacer"></span><button type="button" data-close aria-label="Close inspector" title="Close inspector">×</button></header>
    <div class="body">
      <p class="notice" data-notice role="status"></p>
      <section data-agent-section aria-label="Agent knowledge"><div class="sec-title"><span class="eyebrow">Agent knowledge</span><span class="src">Belief · inspect()</span></div><dl data-agent></dl><div class="label">Recent decisions</div><ol data-log aria-label="Recent decisions, newest first"></ol></section>
      <details data-tree-section><summary>Raw private state <span class="hint">· generic tree</span></summary><div class="tree" data-tree></div></details>
      <section class="observer" data-truth-section aria-label="Observer information, not visible to this drone"><div class="sec-title"><span style="display:flex;gap:6px;align-items:center"><span class="tag">Observer</span><span data-truth-pills style="display:flex;gap:4px"></span></span><span class="hint">not visible to this drone</span></div><dl data-truth></dl></section>
      <section data-peers-section aria-label="Peers: last heard from this drone's state, beside observer truth"><div class="sec-title"><span class="eyebrow">Peers</span><span class="hint" data-peers-ref></span></div><div class="peers-scroll"><table class="peers"><colgroup><col class="id"><col class="heard"><col></colgroup><thead><tr><th scope="col">Peer</th><th scope="col">Last heard · from drone state</th><th scope="col" class="truth">Observer · not visible to this drone</th></tr></thead><tbody data-peers></tbody></table></div></section>
    </div>`;
  host.append(panel);
  const q = <T extends Element>(selector: string) => panel.querySelector<T>(selector)!;
  const idLabel = q<HTMLElement>('[data-id]');
  const pills = q<HTMLElement>('[data-pills]');
  const close = q<HTMLButtonElement>('[data-close]');
  const notice = q<HTMLElement>('[data-notice]');
  const agentSection = q<HTMLElement>('[data-agent-section]');
  const agentList = q<HTMLDListElement>('[data-agent]');
  const log = q<HTMLOListElement>('[data-log]');
  const treeSection = q<HTMLDetailsElement>('[data-tree-section]');
  const tree = q<HTMLElement>('[data-tree]');
  const truthSection = q<HTMLElement>('[data-truth-section]');
  const truthList = q<HTMLDListElement>('[data-truth]');
  const truthPills = q<HTMLElement>('[data-truth-pills]');
  const peersSection = q<HTMLElement>('[data-peers-section]');
  const peersRef = q<HTMLElement>('[data-peers-ref]');
  const peersBody = q<HTMLTableSectionElement>('[data-peers]');
  let lastKey = '';
  let lastRender = 0;
  let renderedId: number | null = null;
  let treeAt = -Infinity;
  let treeKey = '';

  function showSections(agent: boolean, truth: boolean) {
    agentSection.hidden = !agent; treeSection.hidden = !agent; truthSection.hidden = !truth;
  }

  const setNotice = (text: string) => { if (notice.textContent !== text) notice.textContent = text; };   // polite live region: write only on change

  function render(force = false) {
    const id = readViewMode().selectedDroneId;
    const current = connection;
    // Not connected (main.ts has not called connectInspector) renders nothing, like an unselected drone.
    if (id === null || !current) { panel.hidden = true; lastKey = ''; return; }
    panel.hidden = false;
    idLabel.textContent = `#${id}`;
    close.hidden = !current.source.select;
    const { source, arm } = current;
    const view = source.agent(id, arm);
    const truth = source.truth(id, arm);
    const key = `${arm}:${id}:${view?.inspect?.input.tick ?? 'none'}:${truth?.tick ?? 'none'}:${truth?.slotStatusTick ?? 'none'}`;
    if (!force && key === lastKey) return;
    lastKey = key;

    // The header holds only what is not observer truth (the arm, and the drone's own deaf belief). Death is observer
    // truth, so its pill sits inside the hatched observer box.
    const pillList = [element('span', 'pill', arm.toUpperCase())];
    if (view?.belief.deaf) { const deaf = element('span', 'pill deaf', 'deaf'); deaf.title = 'Its own belief: no radio heard for tDeaf'; pillList.push(deaf); }
    pills.replaceChildren(...pillList);
    const observerPills: HTMLElement[] = [];
    if (truth && !truth.alive) { const dead = element('span', 'pill dead', 'dead'); dead.title = `Observer: died at tick ${truth.diedTick ?? '?'}`; observerPills.push(dead); }
    truthPills.replaceChildren(...observerPills);

    setNotice(view ? '' : `No agent data for drone #${id}.`);
    showSections(!!view, !!truth);
    if (view) {
      fillRows(agentList, agentRows(view));
      const dot = element('span', 'dot');
      dot.style.background = `rgb(${versionColour(view.belief.version).map(value => Math.round(value * 255)).join(',')})`;
      agentList.querySelectorAll('dd')[2]?.prepend(dot);
      const entries = decisionLog(view);
      log.replaceChildren(...(entries.length ? entries.map(line => { const item = element('li', undefined, line); item.title = line; return item; }) : [element('li', undefined, 'No decisions logged.')]));
      const now = performance.now();
      const shellKey = `${arm}:${id}`;
      if (treeSection.open && (shellKey !== treeKey || now - treeAt >= TREE_REFRESH_MS)) {
        // Keep what the user expanded and where keyboard focus was; a different drone starts from the root only.
        const openPaths = new Set(shellKey === treeKey ? [...tree.querySelectorAll<HTMLDetailsElement>('details[open]')].map(node => node.dataset.path ?? '') : []);
        openPaths.add('state');
        const focusedPath = tree.contains(document.activeElement) ? document.activeElement?.closest<HTMLElement>('details')?.dataset.path : undefined;
        treeAt = now; treeKey = shellKey;
        const scroll = tree.scrollTop;
        tree.replaceChildren(view.inspect ? renderTree(toTree(view.inspect.state), openPaths) : element('div', 'leaf', 'No step recorded yet.'));
        tree.scrollTop = scroll;
        if (focusedPath) [...tree.querySelectorAll<HTMLDetailsElement>('details')].find(node => node.dataset.path === focusedPath)?.querySelector('summary')?.focus();
      }
    }
    if (truth) fillRows(truthList, truthRows(truth));
    // P2-WP-09: raw peer ages from drone state beside observer truth; hidden when the state has no peer table.
    const peers = peerSection(view, truth);
    peersSection.hidden = peers === null;
    if (peers) {
      peersRef.textContent = peers.reference;
      peersBody.replaceChildren(...peers.rows.map(row => {
        const tr = element('tr');
        tr.append(element('td', undefined, row.id), element('td', undefined, row.heard), element('td', 'truth', row.truth));
        return tr;
      }));
    }
  }

  const onToggle = () => { treeAt = -Infinity; if (treeSection.open) render(true); };
  const onClose = () => connection?.source.select?.(null);
  treeSection.addEventListener('toggle', onToggle);
  close.addEventListener('click', onClose);
  const onConnection = () => render(true);
  listeners.add(onConnection);
  // A new selection shows at once: the controls emit 'encore:control-status' on the shared host after selectDrone.
  const onStatus = () => {
    if (readViewMode().selectedDroneId === renderedId) return;
    renderedId = readViewMode().selectedDroneId; lastRender = performance.now(); render(true);
  };
  host.addEventListener('encore:control-status', onStatus);
  const timer = setInterval(() => {
    const now = performance.now();
    const selectionChanged = readViewMode().selectedDroneId !== renderedId;
    if (!selectionChanged && now - lastRender < (panel.matches(':hover') ? HOVER_REFRESH_MS : REFRESH_MS) - 5) return;
    lastRender = now;
    renderedId = readViewMode().selectedDroneId;
    render();
  }, REFRESH_MS);
  render(true);
  return {
    dispose() {
      clearInterval(timer);
      host.removeEventListener('encore:control-status', onStatus);
      listeners.delete(onConnection);
      treeSection.removeEventListener('toggle', onToggle);
      close.removeEventListener('click', onClose);
      panel.remove();
    },
  };
}
