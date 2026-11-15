// integrations/gateway/loader/register.mjs
// Loaded with `node --import ./loader/register.mjs` by `npm test` and `npm start`. Registers ./resolve.mjs.
import { register } from 'node:module';

register('./resolve.mjs', import.meta.url);
