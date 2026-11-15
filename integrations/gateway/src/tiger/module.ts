// integrations/gateway/src/tiger/module.ts
// PLACEHOLDER for the `tiger` module (Tiger Data analytics, #142, TIG-03). The Tiger Data lane owns this folder and
// replaces this file; the skeleton's registry already imports it, so no skeleton file changes.
// Health entry as tiger-data-integration-work-packages.md and the Tiger analytics RFC §3.1 define it. It receives
// only `TIGER_*` variables. The optional live writer `src/tiger-live/server.ts` (OIB-Q5) is not a registry module.
import { disabledModule, type ModuleFactory } from '../module.ts';

export const createModule: ModuleFactory = () => disabledModule('tiger', { db: 'disabled' });
