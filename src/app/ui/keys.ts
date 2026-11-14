import type { ControlIntent, ControlStatus } from '../actions';

export function bindKeyboard(host: HTMLElement, readStatus: () => ControlStatus | undefined, injection: () => ControlIntent) {
  function onKey(event: KeyboardEvent) {
    const status = readStatus();
    if (!status?.available || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.target instanceof Element && event.target.closest('input,textarea,select,button,[contenteditable=true]')) return;
    const key = event.key.toLowerCase();
    let intent: ControlIntent | undefined;
    if (key === ' ') intent = { type: 'play' };
    else if (key === 'r') intent = { type: 'reset', seed: status.seed };
    else if (key === 'k') intent = { type: 'kill-region' };
    else if (key === 'j' && status.radioFaults) intent = { type: 'jam' };
    else if (key === 'p' && status.radioFaults) intent = { type: 'partition' };
    else if (key === 'i' && status.composition) intent = injection();
    else if (key === 'x' && status.display) intent = { type: 'xray' };
    else if (key === 'c' && status.display) intent = { type: 'belief' };
    else if (key === '[' || key === ']') {
      const speeds = [0.25, 0.5, 1, 2, 4];
      const index = Math.max(0, speeds.indexOf(status.speed));
      intent = { type: 'speed', speed: speeds[Math.max(0, Math.min(speeds.length - 1, index + (key === ']' ? 1 : -1)))] };
    }
    if (intent) { event.preventDefault(); host.dispatchEvent(new CustomEvent('encore:control', { detail: intent })); }
  }
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
