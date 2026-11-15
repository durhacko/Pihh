// tests/app/ui/disruptPopover.test.ts
// #134: the Disrupt popover's radius sliders and its rows, through the real createDisrupt on a headless DOM
// (fakeDom as the global document). Moving a slider writes the one store radius, the row text follows it at once,
// and clicking the row picks with the radius the slider shows, not the one from when the popover rendered.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDisrupt, type PopoverContext } from '../../../src/app/ui/popovers';
import { defaultUIState, Store } from '../../../src/app/ui/store';
import { FakeDocument, FakeElement } from './fakeDom';

// The popover rebuilds its content with replaceChildren, which the focus-test fake does not model.
const proto = FakeElement.prototype as unknown as { replaceChildren?: (...nodes: (FakeElement | string)[]) => void };
proto.replaceChildren ??= function (this: FakeElement, ...nodes: (FakeElement | string)[]) { this.textContent = ''; this.append(...nodes); };

afterEach(() => { vi.unstubAllGlobals(); });

function open(store: Store) {
  vi.stubGlobal('document', new FakeDocument());
  const picks: [string, number][] = [];
  const intents: unknown[] = [];
  const live = { jam: false, partition: false };
  const ctx = {
    store,
    surfaces: { close: () => {} },
    run: (intent: unknown) => { intents.push(intent); return { ok: true, message: '' }; },
    status: () => ({ selectedId: null, selectedAlive: false, loss: 0.05 }),
    live: () => live,
    pick: (purpose: string, radius: number) => { picks.push([purpose, radius]); },
  } as unknown as PopoverContext;
  const popover = createDisrupt(ctx);
  popover.render();
  const el = popover.el as unknown as FakeElement;
  const row = (id: string) => el.findTag('button').find(b => b.getAttribute('data-action') === id)!;
  const slider = (label: string) => el.findTag('input').find(i => i.getAttribute('aria-label') === label)!;
  const drag = (input: FakeElement, value: number) => { (input as unknown as { value: string }).value = String(value); input.dispatch('input'); };
  const desc = (id: string) => row(id).findTag('small')[0].textContent;
  return { picks, intents, live, popover, row, slider, drag, desc };
}

describe('Disrupt radius sliders (#134)', () => {
  it('show the store radius (6 m kill by default) and the row says the same', () => {
    const p = open(new Store(defaultUIState()));
    expect(p.slider('Region radius').getAttribute('value')).toBe('6');
    expect(p.desc('kill-region')).toContain('within 6 m');
    p.row('kill-region').click();
    expect(p.picks).toEqual([['killRegion', 6]]);
  });

  it('a slider moved after the popover rendered is the radius the row shows and the click uses', () => {
    const store = new Store(defaultUIState());
    const p = open(store);
    p.drag(p.slider('Region radius'), 10);
    expect(store.state.killRadius).toBe(10);                 // the one radius K reads too
    expect(p.desc('kill-region')).toContain('within 10 m');  // the row text follows without a re-render
    p.row('kill-region').click();
    expect(p.picks).toEqual([['killRegion', 10]]);           // not the 6 m the row was rendered with
    p.drag(p.slider('Jam radius'), 20);
    expect(store.state.jamRadius).toBe(20);
    expect(p.desc('jam')).toContain('within 20 m');
    p.row('jam').click();
    expect(p.picks.at(-1)).toEqual(['jam', 20]);
  });
});


describe('Disrupt live toggles (#169)', () => {
  it('uses the live jam direction even if the rendered Jam radio button has not refreshed yet', () => {
    const p = open(new Store(defaultUIState()));
    expect(p.row('jam').textContent).toContain('Jam radio');
    p.live.jam = true;
    p.row('jam').click();
    expect(p.intents).toEqual([{ type: 'jam' }]);
    expect(p.picks).toEqual([]);
  });

  it('updates jam and partition labels when live state changes without rebuilding on every refresh', () => {
    const p = open(new Store(defaultUIState()));
    const initialJam = p.row('jam');
    p.popover.refresh();
    expect(p.row('jam')).toBe(initialJam);
    p.live.jam = true;
    p.live.partition = true;
    p.popover.refresh();
    expect(p.row('jam').textContent).toContain('Lift jam');
    expect(p.row('partition').textContent).toContain('Reconnect partition');
    expect(p.row('jam')).not.toBe(initialJam);
    p.row('jam').click();
    expect(p.intents).toEqual([{ type: 'jam' }]);
    expect(p.picks).toEqual([]);
  });
});
