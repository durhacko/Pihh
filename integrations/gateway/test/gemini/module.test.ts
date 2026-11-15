import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGeminiConfig } from '../../src/gemini/config.ts';
import { createModule, defaultGeminiDeps, geminiModule, GENERATE_FORMATION_ROUTE } from '../../src/gemini/index.ts';
import {
  BOUNDED_DROPPED_KEYWORDS, liveGeminiDeps, loadSceneSchemas, loadSlimSceneSchemas, rangesPrompts, responseSchemaSetting, schemaAsTextPrompts,
  schemaRanges, SLIM_DROPPED_KEYWORDS, slimSchema, type LastUpstream,
} from '../../src/gemini/module.ts';
import { PLACEHOLDER_PROMPTS } from '../../src/gemini/geminiProvider.ts';
import { readFileSync } from 'node:fs';
import { fakeProvider, fakeValidator } from './fakes.ts';

const KEY = 'test-key-not-real-0123456789';

test('gemini module: disabled offline, and its route is registered anyway', () => {
  const module = createModule({});
  assert.equal(module.name, 'gemini');
  assert.deepEqual(module.health(), { enabled: false, trialCompile: false });
  assert.deepEqual(module.routes.map(r => [r.method, r.path]), [[GENERATE_FORMATION_ROUTE.method, GENERATE_FORMATION_ROUTE.path]]);
});

test('gemini module (D3): the enable flag AND a key make it live; either alone keeps it off; health never shows the key', () => {
  const live = createModule({ GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY });
  assert.equal(live.health().enabled, true);
  assert.ok(!JSON.stringify(live.health()).includes(KEY));
  assert.ok(!JSON.stringify(live).includes(KEY));
  assert.equal(createModule({ GEMINI_API_KEY: KEY }).health().enabled, false, 'a key without the flag stays off');
  assert.equal(createModule({ GEMINI_ENABLED: '1' }).health().enabled, false, 'the flag without a key stays off');
});

test('gemini module (D3): the live deps send the committed scene schemas through the injected transport, nothing else', async () => {
  const calls: { url: string; body: string; redirect: string }[] = [];
  const transport = async (url: string, init: { body: string; redirect: string }) => {
    calls.push({ url, body: init.body, redirect: init.redirect });
    return { status: 503, body: null };
  };
  const deps = liveGeminiDeps(readGeminiConfig({ GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY }), transport);
  assert.ok(deps.provider);
  const outcome = await deps.provider!.generate({ prompt: 'a white sphere', mode: 'scene3d', attemptTimeoutMs: 5_000 }, new AbortController().signal);
  assert.deepEqual(outcome, { kind: 'upstream-error', status: 503 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent');
  assert.equal(calls[0]!.redirect, 'error');
  const sent = JSON.parse(calls[0]!.body) as { generationConfig: { responseJsonSchema: unknown } };
  assert.deepEqual(sent.generationConfig.responseJsonSchema, loadSceneSchemas().scene3d);
  assert.equal(liveGeminiDeps(readGeminiConfig({})).provider, null, 'disabled: no provider is built');
});

test('GEMINI_RESPONSE_SCHEMA: unset/on = full, slim, off, text; anything else keeps full and is a problem (name only)', () => {
  assert.equal(responseSchemaSetting(undefined), 'full');
  assert.equal(responseSchemaSetting('on'), 'full');
  assert.equal(responseSchemaSetting(' OFF '), 'off');
  assert.equal(responseSchemaSetting('Slim'), 'slim');
  assert.equal(responseSchemaSetting('text'), 'text');
  assert.equal(responseSchemaSetting('bounded'), 'bounded');
  assert.equal(responseSchemaSetting('ranges'), 'ranges');
  const problems: string[] = [];
  assert.equal(responseSchemaSetting('maybe', problems), 'full');
  assert.deepEqual(problems, ['GEMINI_RESPONSE_SCHEMA is not "on", "slim", "bounded", "ranges", "off" or "text"; sending the full schema']);
  assert.ok(!problems[0]!.includes('maybe'));
});

type SentBody = { systemInstruction: { parts: { text: string }[] }; generationConfig: Record<string, unknown> };
async function sentBodies(modes: readonly ('full' | 'slim' | 'bounded' | 'ranges' | 'off' | 'text')[], mode: 'scene3d' | 'silhouette2d' = 'scene3d'): Promise<SentBody[]> {
  const bodies: string[] = [];
  const transport = async (_url: string, init: { body: string }) => { bodies.push(init.body); return { status: 400, body: null }; };
  const config = readGeminiConfig({ GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY });
  for (const m of modes) {
    await liveGeminiDeps(config, transport, undefined, m).provider!.generate({ prompt: 'x', mode, attemptTimeoutMs: 5_000 }, new AbortController().signal);
  }
  assert.equal(bodies.length, modes.length, 'exactly one transport call per generation');
  return bodies.map(b => JSON.parse(b) as SentBody);
}

test('each schema mode sends what it says: full and slim as responseJsonSchema; off and text JSON mode without it; only text changes the prompt', async () => {
  for (const mode of ['scene3d', 'silhouette2d'] as const) {
    const [full, slim, off, text] = await sentBodies(['full', 'slim', 'off', 'text'], mode);
    assert.deepEqual(full!.generationConfig.responseJsonSchema, loadSceneSchemas()[mode]);
    assert.deepEqual(slim!.generationConfig.responseJsonSchema, loadSlimSceneSchemas()[mode]);
    for (const b of [off!, text!]) {
      assert.ok(!('responseJsonSchema' in b.generationConfig));
      assert.equal(b.generationConfig.responseMimeType, 'application/json');
    }
    for (const b of [full!, slim!, off!]) assert.equal(b.systemInstruction.parts[0]!.text, PLACEHOLDER_PROMPTS[mode]);
    const prompt = text!.systemInstruction.parts[0]!.text;
    assert.ok(prompt.startsWith(PLACEHOLDER_PROMPTS[mode]) && prompt.includes('PLACEHOLDER line for William\'s review'));
    assert.ok(prompt.includes('"version": 1') && prompt.includes(`"mode": "${mode}"`));
    assert.ok(prompt.endsWith(JSON.stringify(loadSlimSceneSchemas()[mode])), 'the slim schema, as text');
    assert.deepEqual(schemaAsTextPrompts()[mode], prompt);
  }
});

/** Every `$ref` target and every schema position in a node, walked by keyword (as slimSchema does). */
function walkSchemas(node: unknown, visit: (schema: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) { node.forEach(n => walkSchemas(n, visit)); return; }
  if (node === null || typeof node !== 'object') return;
  const schema = node as Record<string, unknown>;
  visit(schema);
  for (const key of ['properties', '$defs'] as const) {
    const map = schema[key];
    if (map && typeof map === 'object') Object.values(map).forEach(s => walkSchemas(s, visit));
  }
  for (const key of ['items', 'anyOf', 'additionalProperties'] as const) walkSchemas(schema[key], visit);
}

test('slim schema (E1): drops only bounds and prose, at keyword positions; keeps structure, enums, required and every $ref target', () => {
  for (const mode of ['silhouette2d', 'scene3d'] as const) {
    const full = loadSceneSchemas()[mode] as Record<string, unknown>;
    const before = JSON.stringify(full);
    const slim = loadSlimSceneSchemas()[mode] as Record<string, unknown>;
    assert.equal(JSON.stringify(full), before, 'the committed schema is not mutated');
    walkSchemas(slim, s => { for (const k of SLIM_DROPPED_KEYWORDS) assert.ok(!(k in s), `${mode}: ${k} left in a schema`); });
    // Re-adding nothing, the slim schema equals the full one with exactly those keywords removed at schema positions.
    const strip = (n: unknown): unknown => {
      walkSchemas(n, s => { for (const k of SLIM_DROPPED_KEYWORDS) delete s[k]; });
      return n;
    };
    assert.deepEqual(slim, strip(structuredClone(full)));
    const props = slim.properties as Record<string, Record<string, unknown>>;
    assert.deepEqual(props.version, { type: 'integer', enum: [1] });
    assert.deepEqual(props.mode, { type: 'string', enum: [mode] });
    assert.deepEqual(slim.required, full.required);
    assert.equal(slim.additionalProperties, false);
    const defs = slim.$defs as Record<string, unknown>;
    walkSchemas(slim, s => {
      if (typeof s.$ref === 'string') assert.ok(s.$ref.replace('#/$defs/', '') in defs, `${mode}: dangling ${s.$ref}`);
    });
  }
  const props3d = (loadSlimSceneSchemas().scene3d as { properties: Record<string, unknown>; required: string[] });
  assert.deepEqual(props3d.properties.title, { type: 'string' }, 'a PROPERTY named title stays (its description goes)');
  assert.ok(props3d.required.includes('title'));
  assert.deepEqual(slimSchema({ properties: { minimum: { type: 'number', minimum: 0 } } }), { properties: { minimum: { type: 'number' } } });
});

test('bounded (E3a): slim but keeping every numeric minimum/maximum; sent as responseJsonSchema with the unchanged prompt', async () => {
  for (const mode of ['silhouette2d', 'scene3d'] as const) {
    const full = loadSceneSchemas()[mode];
    const bounded = loadSlimSceneSchemas(BOUNDED_DROPPED_KEYWORDS)[mode];
    walkSchemas(bounded, s => { for (const k of BOUNDED_DROPPED_KEYWORDS) assert.ok(!(k in s), `${mode}: ${k} left`); });
    const bounds = (n: unknown): string[] => { const b: string[] = []; walkSchemas(n, s => { if ('minimum' in s || 'maximum' in s) b.push(`${String(s.minimum)},${String(s.maximum)}`); }); return b; };
    assert.ok(bounds(full).length > 0);
    assert.deepEqual(bounds(bounded), bounds(full), 'every numeric bound is kept, in place');
    const [sent] = await sentBodies(['bounded'], mode);
    assert.deepEqual(sent!.generationConfig.responseJsonSchema, bounded);
    assert.equal(sent!.systemInstruction.parts[0]!.text, PLACEHOLDER_PROMPTS[mode]);
  }
});

test('ranges (E3b): slim schema, plus one PLACEHOLDER line with the ranges derived from the committed schema', async () => {
  const ranges3d = schemaRanges(loadSceneSchemas().scene3d);
  for (const r of ['$defs/coord in [-1.5, 1.5]', '$defs/size in [0.005, 1]', '$defs/rotation in [-360, 360]', 'rgb in [0, 1]', 'importance in [1, 5]', 'topRadius in [0, 1]']) {
    assert.ok(ranges3d.includes(r), r);
  }
  assert.equal(new Set(ranges3d).size, ranges3d.length, 'no duplicates');
  for (const mode of ['silhouette2d', 'scene3d'] as const) {
    const [sent] = await sentBodies(['ranges'], mode);
    assert.deepEqual(sent!.generationConfig.responseJsonSchema, loadSlimSceneSchemas()[mode]);
    const prompt = sent!.systemInstruction.parts[0]!.text;
    assert.ok(prompt.startsWith(PLACEHOLDER_PROMPTS[mode]) && prompt.includes('PLACEHOLDER line for William\'s review'));
    for (const r of schemaRanges(loadSceneSchemas()[mode])) assert.ok(prompt.includes(r), `${mode}: ${r}`);
    assert.deepEqual(rangesPrompts()[mode], prompt);
  }
});

test('gemini module (D3): the sent schemas drop the document-only $id/$schema; everything else is the committed file', () => {
  for (const [mode, file] of [['silhouette2d', 'scene2d'], ['scene3d', 'scene3d']] as const) {
    const committed = JSON.parse(readFileSync(new URL(`../../../../src/score/generated/schema/${file}.schema.json`, import.meta.url), 'utf8')) as Record<string, unknown>;
    const sent = loadSceneSchemas()[mode] as Record<string, unknown>;
    assert.ok(!('$id' in sent) && !('$schema' in sent));
    const rest = Object.fromEntries(Object.entries(committed).filter(([key]) => key !== '$id' && key !== '$schema'));
    assert.deepEqual(sent, rest);
  }
});

test('gemini module (D3): health shows the last upstream call, sanitised (status, outcome, finish reason, latency), never secrets', async () => {
  let last: LastUpstream | null = null;
  const transport = async () => ({ status: 400, body: null });
  const config = readGeminiConfig({ GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY });
  const module = geminiModule(liveGeminiDeps(config, transport, l => { last = l; }), { random: () => 0.5, sleep: async () => {} }, () => last);
  assert.deepEqual(module.health(), { enabled: true, trialCompile: false }, 'no lastUpstream before any call');
  const route = module.routes[0]!;
  await route.handle({ rawBody: JSON.stringify({ prompt: 'a white sphere', mode: 'scene3d' }) } as Parameters<typeof route.handle>[0]);
  const health = module.health() as { lastUpstream?: LastUpstream };
  assert.equal(health.lastUpstream?.httpStatus, 400);
  assert.equal(health.lastUpstream?.outcome, 'upstream-error');
  const text = JSON.stringify(health);
  for (const secret of [KEY, 'a white sphere']) assert.ok(!text.includes(secret), secret);
});

test('gemini module: enabled only with config, provider and validator together', () => {
  const config = readGeminiConfig({ GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY });
  const provider = fakeProvider(async () => ({ kind: 'blocked' }));
  const validator = fakeValidator(() => ({ ok: false, issues: [] }));
  assert.equal(geminiModule({ config, provider, validator }).health().enabled, true);
  assert.equal(geminiModule({ config, provider: null, validator }).health().enabled, false);
  assert.equal(geminiModule({ config, provider, validator: null }).health().enabled, false);
  assert.equal(geminiModule({ config: readGeminiConfig({}), provider, validator }).health().enabled, false);
  assert.equal(geminiModule(defaultGeminiDeps(config)).health().enabled, false);
});

test('(6) createModule reports ignored GEMINI_* values as problems, never their values', () => {
  const module = createModule({ GEMINI_ENABLED: '1', GEMINI_API_KEY: KEY, GEMINI_MODEL: 'Bad Model!', GEMINI_REQUEST_TIMEOUT_MS: '-5' });
  assert.equal(module.problems?.length, 2);
  assert.ok(module.problems?.every(p => !p.includes('Bad Model!') && !p.includes('-5') && !p.includes(KEY)));
  assert.deepEqual(createModule({}).problems, [], 'a disabled module reads, and reports, nothing');
});
