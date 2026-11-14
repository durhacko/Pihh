// tests/app/ui/dom.test.ts
// Pure helpers, the icon set, and the rule that these shared modules are not panels and have no import effects.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { esc, fmt, fmtTime, isTyping, vec } from '../../../src/app/ui/dom';
import { icon } from '../../../src/app/ui/icons';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SHARED = ['store', 'surfaces', 'dom', 'icons'];

describe('dom helpers', () => {
  it('esc escapes HTML metacharacters', () => {
    expect(esc(`<b a="1">'x' & y</b>`)).toBe('&lt;b a=&quot;1&quot;&gt;&#39;x&#39; &amp; y&lt;/b&gt;');
  });

  it('fmtTime gives mm:ss.s on the 20 Hz clock and never shows 60 seconds', () => {
    expect(fmtTime(0)).toBe('00:00.0');
    expect(fmtTime(20)).toBe('00:01.0');
    expect(fmtTime(1234)).toBe('01:01.7');
    expect(fmtTime(2399)).toBe('02:00.0');   // 119.95 s rounds to 120.0, not "01:60.0"
  });

  it('fmt keeps missing values visibly missing', () => {
    expect(fmt(0.98765)).toBe('0.99');
    expect(fmt(null)).toBe('—');
    expect(fmt(undefined)).toBe('—');
    expect(fmt(Number.NaN)).toBe('—');
    expect(vec([1, 2.25, -3])).toBe('(1.0, 2.3, -3.0)');
  });

  it('isTyping is false without a DOM (and for non-elements)', () => {
    expect(isTyping(null)).toBe(false);
    expect(isTyping({} as EventTarget)).toBe(false);
  });
});

describe('icons', () => {
  it('every icon is static, decorative SVG with no network reference', () => {
    for (const [name, svg] of Object.entries(icon)) {
      expect(svg, name).toMatch(/^<svg [^>]*aria-hidden="true"/);
      expect(svg, name).not.toMatch(/https?:|xlink:href|<script/i);
    }
  });
});

describe('shared UI modules', () => {
  it('none exports createPanel, so the panel loader skips them', async () => {
    for (const name of SHARED) {
      const mod = await import(`../../../src/app/ui/${name}.ts`);
      expect(Object.keys(mod), name).not.toContain('createPanel');
    }
  });

  it('importing them touches no DOM global (they load headless in node)', async () => {
    expect(typeof document).toBe('undefined');
    for (const name of SHARED) await expect(import(`../../../src/app/ui/${name}.ts`)).resolves.toBeDefined();
  });

  it('styles.css takes fonts from @fontsource and has no network URL', () => {
    const css = readFileSync(resolve(root, 'src/app/ui/styles.css'), 'utf8');
    expect(css).toContain("@import '@fontsource-variable/inter';");
    expect(css).toContain("@import '@fontsource-variable/jetbrains-mono';");
    expect(css).not.toMatch(/https?:\/\/|\/\/fonts\.|url\(\s*['"]?(https?:)?\/\//i);
    expect(css).toMatch(/--sans: 'Inter Variable'/);
    expect(css).toMatch(/--mono: 'JetBrains Mono Variable'/);
  });

  it('pins both font packages to an exact version', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    for (const name of ['@fontsource-variable/inter', '@fontsource-variable/jetbrains-mono']) {
      expect(pkg.dependencies[name], name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
