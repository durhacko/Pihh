// tests/app/keys.test.ts
// Global shortcuts (#92): one map; typing never fires a shortcut; modified keys and key repeat are left to the
// browser; Space on a focused button is left to the button. Pure: shortcutFor needs no DOM.
import { describe, expect, it } from 'vitest';
import { shortcutFor } from '../../src/app/ui/keys';

describe('shortcutFor', () => {
  it('maps the DESIGN §2.3 keys, case-insensitively', () => {
    const cases: [string, string][] = [[' ', 'play'], ['.', 'step'], ['[', 'slower'], [']', 'faster'], ['r', 'reset'], ['R', 'reset'],
      ['1', 'camera-audience'], ['2', 'camera-quarter'], ['3', 'camera-top'], ['k', 'kill-region'], ['j', 'jam'], ['p', 'partition'],
      ['x', 'xray'], ['c', 'belief'], ['b', 'view'], ['m', 'metrics'], ['h', 'hide'], ['?', 'help'], ['f', 'compose'], ['/', 'console']];
    for (const [key, action] of cases) expect(shortcutFor({ key }, false), key).toBe(action);
    expect(shortcutFor({ key: 'q' }, false)).toBeNull();
  });

  it('never fires while typing in a field', () => {
    for (const key of [' ', 'r', 'k', 'j', 'x', 'h', '?', '1', '.']) expect(shortcutFor({ key }, true), key).toBeNull();
  });

  it('leaves modified keys and auto-repeat to the browser', () => {
    expect(shortcutFor({ key: 'r', ctrlKey: true }, false)).toBeNull();
    expect(shortcutFor({ key: 'r', metaKey: true }, false)).toBeNull();
    expect(shortcutFor({ key: 'k', altKey: true }, false)).toBeNull();
    expect(shortcutFor({ key: 'k', repeat: true }, false)).toBeNull();
  });

  it('Space on a focused button is the button\'s; every other key still works there', () => {
    expect(shortcutFor({ key: ' ' }, false, true)).toBeNull();
    for (const key of ['k', 'j', 'p', 'x', 'c', 'r', ']', '[', 'm', 'h']) expect(shortcutFor({ key }, false, true), key).not.toBeNull();
  });
});
