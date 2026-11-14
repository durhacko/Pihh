// tests/app/keys.test.ts
// Keyboard shortcuts must keep working after a panel click leaves focus on a button; only Space is ignored
// there (it activates the button natively). Headless: window and Element are minimal stubs.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ControlIntent, ControlStatus } from '../../src/app/actions';
import { bindKeyboard } from '../../src/app/ui/keys';

class FakeElement {
  constructor(private readonly tag: string) {}
  closest(selector: string) { return selector.split(',').includes(this.tag) ? this : null; }
}
const status: ControlStatus = {
  available: true, playing: true, speed: 1, seed: 1, loss: 0.05, selectedId: 3, selectedAlive: true,
  radioFaults: true, composition: true, display: true, message: '',
};

function bind() {
  let onKey: ((event: KeyboardEvent) => void) | undefined;
  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('window', { addEventListener: (_: string, fn: (event: KeyboardEvent) => void) => { onKey = fn; }, removeEventListener: () => {} });
  const host = new EventTarget() as HTMLElement;
  const intents: ControlIntent[] = [];
  host.addEventListener('encore:control', event => intents.push((event as CustomEvent<ControlIntent>).detail));
  bindKeyboard(host, () => status, () => ({ type: 'inject', recipe: { kind: 'sphere' } }));
  const press = (key: string, tag: string) => onKey!({ key, target: new FakeElement(tag), repeat: false, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {} } as unknown as KeyboardEvent);
  return { intents, press };
}

describe('bindKeyboard focus rules', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('letter and bracket shortcuts still work while a button has focus', () => {
    const { intents, press } = bind();
    for (const key of ['k', 'j', 'p', 'i', 'x', 'c', 'r', ']', '[']) press(key, 'button');
    expect(intents.map(intent => intent.type)).toEqual(['kill-region', 'jam', 'partition', 'inject', 'xray', 'belief', 'reset', 'speed', 'speed']);
  });

  it('Space is ignored on a focused button but plays/pauses elsewhere', () => {
    const { intents, press } = bind();
    press(' ', 'button');
    expect(intents).toEqual([]);
    press(' ', 'canvas');
    expect(intents).toEqual([{ type: 'play' }]);
  });

  it('typing into a field never triggers shortcuts', () => {
    const { intents, press } = bind();
    for (const tag of ['input', 'textarea', 'select']) press('k', tag);
    expect(intents).toEqual([]);
  });
});
