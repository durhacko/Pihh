// integrations/gateway/src/shows/module.ts
// PLACEHOLDER for the `shows` module (MongoDB Atlas show library, #130, MDB-WP-03). The MongoDB lane owns this
// folder and replaces this file; the skeleton's registry already imports it, so no skeleton file changes.
// Health entry as `mongodb-atlas-show-library.md` §10.4 defines it. It receives only `MONGODB_*` variables.
import { disabledModule, type ModuleFactory } from '../module.ts';

export const createModule: ModuleFactory = () => disabledModule('shows', { db: 'disabled', writable: false });
