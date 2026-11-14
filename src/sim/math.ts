import type { Vec3 } from '../contracts';

export const lengthSquared = (v: Vec3): number => v[0] ** 2 + v[1] ** 2 + v[2] ** 2;
export const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const distanceSquared = (a: Vec3, b: Vec3): number => lengthSquared(subtract(a, b));
export function clampLength(v: Vec3, max: number): Vec3 {
  const size = Math.sqrt(lengthSquared(v));
  const scale = size > max ? max / size : 1;
  return [v[0] * scale, v[1] * scale, v[2] * scale];
}

export function launchPosition(id: number, n0: number): Vec3 {
  const columns = Math.ceil(Math.sqrt(n0));
  const rows = Math.ceil(n0 / columns);
  return [(id % columns - (columns - 1) / 2) * 1.5, 0, (Math.floor(id / columns) - (rows - 1) / 2) * 1.5];
}
