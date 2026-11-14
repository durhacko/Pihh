// src/app/ui/icons.ts
// 16px line icons, stroke 1.5, drawn for Encore (no icon font, works offline). Each is trusted static SVG
// markup for h(tag, { html: icon.x }). Decorative: aria-hidden, so the control carrying one needs its own label.
// Shared module: it does not export createPanel, so the panel loader in ./index.ts imports it without effect.
const s = (body: string): string =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** The 26px formation-type glyphs drawn from dots (text, sphere, double helix). */
const textGlyph = (): string => {
  const dots: [number, number][] = [[3, 6], [3, 10], [3, 14], [3, 18], [7, 6], [7, 12], [7, 18], [11, 6], [11, 18], [15, 6], [15, 10], [15, 14], [15, 18], [19, 6], [19, 18], [23, 6], [23, 10], [23, 14], [23, 18], [19, 12]];
  return `<svg viewBox="0 0 26 26" aria-hidden="true" fill="currentColor">${dots.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.25"/>`).join('')}</svg>`;
};
const sphereGlyph = (): string => {
  const dots = Array.from({ length: 22 }, (_, i) => {
    const t = (i / 22) * Math.PI * 2;
    const r = i % 2 ? 6 : 10;
    return `<circle cx="${(13 + Math.cos(t) * r).toFixed(1)}" cy="${(13 + Math.sin(t) * r * 0.95).toFixed(1)}" r="1.2"/>`;
  }).join('');
  return `<svg viewBox="0 0 26 26" aria-hidden="true" fill="currentColor">${dots}<circle cx="13" cy="13" r="1.2"/></svg>`;
};
const helixGlyph = (): string => {
  const dots = Array.from({ length: 11 }, (_, i) => {
    const y = 3 + i * 2;
    const x = Math.sin(i * 0.75) * 7;
    return `<circle cx="${(13 + x).toFixed(1)}" cy="${y}" r="1.2"/><circle cx="${(13 - x).toFixed(1)}" cy="${y}" r="1.2" opacity=".55"/>`;
  }).join('');
  return `<svg viewBox="0 0 26 26" aria-hidden="true" fill="currentColor">${dots}</svg>`;
};

export const icon = {
  play: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6L12.6 8z" fill="currentColor"/></svg>`,
  pause: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="3.2" width="2.6" height="9.6" rx=".6" fill="currentColor"/><rect x="9.4" y="3.2" width="2.6" height="9.6" rx=".6" fill="currentColor"/></svg>`,
  reset: s('<path d="M3 8a5 5 0 1 0 1.6-3.7"/><path d="M3 2.5v2.8h2.8"/>'),
  step: s('<path d="M4 3.5v9l6-4.5z"/><path d="M12.5 3.5v9"/>'),
  compose: s('<circle cx="4" cy="4" r="1.2"/><circle cx="8" cy="4" r="1.2"/><circle cx="12" cy="4" r="1.2"/><circle cx="6" cy="8" r="1.2"/><circle cx="10" cy="8" r="1.2"/><circle cx="8" cy="12" r="1.2"/>'),
  disrupt: s('<path d="M8 2v3M8 11v3M2 8h3M11 8h3"/><circle cx="8" cy="8" r="2.2"/>'),
  lenses: s('<circle cx="6.5" cy="8" r="4"/><circle cx="9.5" cy="8" r="4"/>'),
  timeline: s('<path d="M2 5h12M2 11h12"/><rect x="3" y="3" width="4" height="4" rx="1"/><rect x="8" y="9" width="5" height="4" rx="1"/>'),
  console: s('<path d="M3 4.5 6.5 8 3 11.5M8 12h5"/>'),
  help: s('<circle cx="8" cy="8" r="6"/><path d="M6.3 6.3a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.4"/><circle cx="8" cy="11.6" r=".5" fill="currentColor"/>'),
  close: s('<path d="M4 4l8 8M12 4l-8 8"/>'),
  target: s('<circle cx="8" cy="8" r="5"/><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3"/>'),
  kill: s('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/><circle cx="8" cy="8" r="6"/>'),
  region: s('<circle cx="8" cy="8" r="5.5" stroke-dasharray="2 2"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/>'),
  dice: s('<rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><circle cx="5.7" cy="5.7" r=".7" fill="currentColor"/><circle cx="10.3" cy="10.3" r=".7" fill="currentColor"/><circle cx="8" cy="8" r=".7" fill="currentColor"/>'),
  jam: s('<path d="M3 11a7 7 0 0 1 10 0M5 8.8a4 4 0 0 1 6 0"/><circle cx="8" cy="12" r=".8" fill="currentColor"/><path d="M2 2l12 12"/>'),
  split: s('<path d="M8 2v12" stroke-dasharray="1.6 1.6"/><circle cx="4.5" cy="6" r="1"/><circle cx="4" cy="10" r="1"/><circle cx="11.5" cy="7" r="1"/><circle cx="11" cy="11" r="1"/>'),
  loss: s('<path d="M2 12h2l2-6 2 8 2-5 2 3h2"/>'),
  inject: s('<path d="M8 2v8M5 7l3 3 3-3"/><circle cx="8" cy="13" r="1.3"/>'),
  eye: s('<path d="M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8z"/><circle cx="8" cy="8" r="1.8"/>'),
  metrics: s('<path d="M2.5 13.5h11M4.5 11V8M8 11V4M11.5 11V6.5"/>'),
  chevL: s('<path d="M10 3.5 5.5 8l4.5 4.5"/>'),
  chevR: s('<path d="M6 3.5 10.5 8 6 12.5"/>'),
  expand: s('<path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3"/>'),
  camera: s('<rect x="2" y="4.5" width="9" height="7" rx="1.5"/><path d="M11 7l3-1.5v5L11 9"/>'),
  text: textGlyph(),
  sphere: sphereGlyph(),
  helix: helixGlyph(),
} as const;

export type IconName = keyof typeof icon;
