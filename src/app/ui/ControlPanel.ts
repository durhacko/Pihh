import type { ControlIntent, ControlStatus } from '../actions';
import type { PanelContext } from './index';
import { bindKeyboard } from './keys';

/** DOM only: emits intents and renders app-authority status, never holds a world. */
export function createPanel({ host }: PanelContext) {
  const panel = document.createElement('aside');
  panel.className = 'encore-control';
  panel.setAttribute('aria-label', 'Simulation controls');
  panel.innerHTML = `<style>
    .encore-control{position:absolute;left:40px;top:180px;width:246px;max-height:calc(100dvh - 320px);overflow:auto;padding:18px;border:1px solid #24404f;border-radius:10px;background:#06121de8;box-shadow:0 15px 40px #0005;color:#c4d9e2;font:12px system-ui;z-index:3}
    .encore-control h2{font-size:11px;letter-spacing:.15em;color:#87adbe;margin:0 0 14px}.encore-control fieldset{border:0;padding:0;margin:0}.encore-control .row{display:flex;gap:7px;margin-bottom:8px}.encore-control label{display:block;color:#7896a6;font-size:11px;margin:12px 0 6px}.encore-control button,.encore-control select,.encore-control input{font:inherit;background:#102633;border:1px solid #2a4757;border-radius:5px;padding:9px;color:#d2e7ef;min-width:0}.encore-control button{cursor:pointer;flex:1}.encore-control input,.encore-control select{width:100%}.encore-control button:hover:not(:disabled){background:#1b3d4d}.encore-control :disabled{opacity:.38;cursor:not-allowed}.encore-control :focus-visible{outline:2px solid #71d5dd;outline-offset:2px}.encore-control .divider{border-top:1px solid #1c3543;margin:15px 0}.encore-control output{display:block;color:#93b4c2;font-size:11px;line-height:1.6;margin-top:12px}.encore-control small{font-size:10px;color:#607f90}.encore-control kbd{font:10px system-ui;opacity:.55;margin-left:4px}@media(max-width:700px){.encore-control{left:20px;top:150px;width:205px;padding:12px;max-height:calc(100dvh - 290px)}}
  </style><h2>SIMULATION CONTROLS</h2><fieldset disabled>
    <div class="row"><button data-action="play">Play / pause <kbd>Space</kbd></button><select aria-label="Playback speed" data-speed><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select></div>
    <label for="encore-seed">Seed</label><div class="row"><input id="encore-seed" data-seed type="number" min="0" max="4294967295" step="1" value="101"><button data-action="reset">Reset <kbd>R</kbd></button></div>
    <div class="divider"></div><label for="encore-selection">Drone id</label><div class="row"><input id="encore-selection" data-selection type="number" min="0" step="1" placeholder="None"><button data-action="select">Select</button></div><small data-selection-status>No drone selected.</small>
    <div class="row" style="margin-top:12px"><button data-action="kill-region" data-needs-selection>Kill region <kbd>K</kbd></button><button data-action="kill-selected" data-needs-selection>Kill selected</button></div><button data-action="kill-random" style="width:100%">Kill random 10%</button>
    <div class="row" style="margin-top:8px"><button data-action="jam" data-needs-radio>Jam on / off <kbd>J</kbd></button><button data-action="partition" data-needs-radio>Partition <kbd>P</kbd></button></div>
    <label for="encore-loss">Packet loss</label><select id="encore-loss" data-loss data-needs-radio><option value="0">0%</option><option value="0.05" selected>5%</option><option value="0.2">20%</option><option value="0.5">50%</option><option value="1">100%</option></select>
    <div class="divider"></div><label for="encore-recipe">New composition</label><select id="encore-recipe" data-recipe><option value="text">Text</option><option value="sphere">Sphere</option><option value="helix">Double helix</option></select><input data-text aria-label="Composition text" maxlength="20" value="ENCORE" style="margin-top:8px"><button data-action="inject" data-needs-composition style="width:100%;margin-top:8px">Inject into selected <kbd>I</kbd></button>
    <div class="divider"></div><div class="row"><button data-action="xray" data-needs-display>X-ray <kbd>X</kbd></button><button data-action="belief" data-needs-display>Belief colours <kbd>C</kbd></button></div>
  </fieldset><output role="status">Real simulation controls unavailable. Waiting for the simulation connection.</output>`;
  host.append(panel);
  const fieldset = panel.querySelector<HTMLFieldSetElement>('fieldset')!;
  const output = panel.querySelector<HTMLOutputElement>('output')!;
  const seed = panel.querySelector<HTMLInputElement>('[data-seed]')!;
  const selection = panel.querySelector<HTMLInputElement>('[data-selection]')!;
  const speed = panel.querySelector<HTMLSelectElement>('[data-speed]')!;
  const recipe = panel.querySelector<HTMLSelectElement>('[data-recipe]')!;
  const loss = panel.querySelector<HTMLSelectElement>('[data-loss]')!;
  const text = panel.querySelector<HTMLInputElement>('[data-text]')!;
  let status: ControlStatus | undefined;
  const inject = (): ControlIntent => ({ type: 'inject', recipe: recipe.value === 'text' ? { kind: 'text', text: text.value } : { kind: recipe.value as 'sphere' | 'helix' } });
  function send(intent: ControlIntent) { host.dispatchEvent(new CustomEvent('encore:control', { detail: intent })); }
  function onClick(event: MouseEvent) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!button || button.disabled || !status?.available) return;
    const action = button.dataset.action;
    if (action === 'reset') send({ type: 'reset', seed: Number(seed.value) });
    else if (action === 'select') send({ type: 'select', id: selection.value === '' ? null : Number(selection.value) });
    else if (action === 'inject') send(inject());
    else if (action) send({ type: action } as ControlIntent);
  }
  function onStatus(event: Event) {
    status = (event as CustomEvent<ControlStatus>).detail;
    fieldset.disabled = !status.available;
    panel.querySelector('[data-action=play]')!.textContent = status.playing ? 'Pause · Space' : 'Play · Space';
    if (document.activeElement !== seed) seed.value = String(status.seed);
    if (document.activeElement !== selection) selection.value = status.selectedId === null ? '' : String(status.selectedId);
    speed.value = String(status.speed);
    loss.value = String(status.loss);
    panel.querySelector('[data-selection-status]')!.textContent = status.selectedId === null ? 'No drone selected.' : `Drone ${status.selectedId} · ${status.selectedAlive ? 'live' : 'dead'}`;
    for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-needs-selection]')) button.disabled = !status.selectedAlive;
    for (const control of panel.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('[data-needs-radio]')) control.disabled = !status.radioFaults;
    for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-needs-composition]')) button.disabled = !status.composition || !status.selectedAlive;
    for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-needs-display]')) button.disabled = !status.display;
    output.textContent = status.message;
  }
  const onSpeed = () => send({ type: 'speed', speed: Number(speed.value) });
  const onLoss = () => send({ type: 'loss', loss: Number(loss.value) });
  const onRecipe = () => { text.hidden = recipe.value !== 'text'; };
  panel.addEventListener('click', onClick); host.addEventListener('encore:control-status', onStatus);
  speed.addEventListener('change', onSpeed); recipe.addEventListener('change', onRecipe); loss.addEventListener('change', onLoss);
  const unbindKeys = bindKeyboard(host, () => status, inject);
  host.dispatchEvent(new Event('encore:control-query'));
  return { dispose() { unbindKeys(); panel.removeEventListener('click', onClick); host.removeEventListener('encore:control-status', onStatus); speed.removeEventListener('change', onSpeed); recipe.removeEventListener('change', onRecipe); loss.removeEventListener('change', onLoss); panel.remove(); } };
}
