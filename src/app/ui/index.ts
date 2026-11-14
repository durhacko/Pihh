export interface PanelContext { host: HTMLElement }
export interface Panel { dispose(): void }
export type PanelFactory = (context: PanelContext) => Panel;

const modules = import.meta.glob<{ createPanel?: PanelFactory }>(['./*.ts', '!./index.ts'], { eager: true });

/** Optional panels export createPanel from their own module; no shared edits. */
export function createPanels(context: PanelContext): Panel[] {
  return Object.keys(modules).sort().flatMap(path => {
    const create = modules[path].createPanel;
    return create ? [create(context)] : [];
  });
}
