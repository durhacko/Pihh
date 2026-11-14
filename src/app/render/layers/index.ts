import type { Layer, LayerFactory } from '../Layer';

const modules = import.meta.glob<{ default?: LayerFactory }>('./*Layer.ts', { eager: true });

/** A new layer registers by exporting a default factory from its own file. */
export function createLayers(): Layer[] {
  return Object.keys(modules).sort().flatMap(path => {
    const create = modules[path].default;
    return create ? [create()] : [];
  });
}
