// src/cli/observer.ts
// The one place the CLI resolves the observer implementation, so swapping it is a one-line change.
import type { Observer, Params } from '../contracts';
import { createObserver } from '../observer';

export type ObserverFactory = (params: Params) => Observer;

export function getObserverFactory(): ObserverFactory {
  return createObserver;
}
