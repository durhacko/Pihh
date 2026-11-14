import { DT, OPERATOR } from '../contracts';
import type { AgentInput, AgentOutput, EnvEvent, Message, RadioEvent, Vec3, World, WorldConfig, WorldSnapshot } from '../contracts';
import { SpatialGrid } from './grid';
import { clampLength, distanceSquared, launchPosition, subtract } from './math';
import { createRandom, hashSeed, hashText } from './random';

interface Body {
  id: number; alive: boolean; diedTick: number | null;
  pos: Vec3; vel: Vec3; colour: Vec3; state: unknown;
  last: { input: AgentInput; output: AgentOutput } | null;
}
interface Pending { receiver: number; message: Message }
type Jam = WorldSnapshot['jams'][number];
type Partition = WorldSnapshot['partitions'][number] & { groups: (0 | 1)[] };
type TestOptions = { reverseStepOrder?: boolean; freezeInputs?: boolean };
/** Contracts contain only plain JSON data. Avoid structuredClone's per-call overhead
 * on the thousands of small sensing/radio vectors produced by a tick. */
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(entry => clone(entry)) as T;
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) copy[key] = clone((value as Record<string, unknown>)[key]);
    return copy as T;
  }
  return value;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}

export function createWorld(source: WorldConfig, test: TestOptions = {}): World {
  const params = freeze(clone(source.params));
  if (!Number.isInteger(params.n0) || params.n0 < 1) throw new Error('n0 must be a positive integer');
  if (params.rSense <= 0 || params.rRadio <= 0) throw new Error('Sensing and radio radii must be positive');
  if (!Number.isInteger(params.latencyMin) || !Number.isInteger(params.latencyMax) || params.latencyMin < 1 || params.latencyMax < params.latencyMin) throw new Error('Invalid radio latency');
  if (params.loss < 0 || params.loss > 1) throw new Error('Invalid packet loss');
  const score = freeze(clone(source.score));
  const brain = Object.freeze({ ...source.brain });
  const config = Object.freeze({ seed: source.seed, params, score, brain, events: freeze(clone(source.events ?? [])) });
  const rng = createRandom(hashSeed(source.seed, -1));
  let tick = 0;
  const bodies: Body[] = Array.from({ length: params.n0 }, (_, id) => ({
    id, alive: true, diedTick: null, pos: launchPosition(id, params.n0), vel: [0, 0, 0], colour: [0, 0, 0],
    state: clone(brain.init({ id, n0: params.n0, initialSlot: id, params: clone(params), score: clone(score), seed: hashSeed(source.seed, id) })),
    last: null,
  }));
  const events = new Map<number, EnvEvent[]>();
  const pending = new Map<number, Pending[]>();
  const jams = new Map<string, Jam>();
  const partitions = new Map<string, Partition>();
  let loss = params.loss;
  let operatorSeq = 0;
  let collisionPairs = new Set<string>();
  let nearPairs = new Set<string>();

  function schedule(event: EnvEvent) {
    if (!Number.isInteger(event.tick) || event.tick <= tick) throw new Error('Events must be scheduled after the current tick');
    if (event.type === 'JAM_ON' && (!Number.isFinite(event.radius) || event.radius < 0)) throw new Error('Invalid jam radius');
    if (event.type === 'SET_LOSS' && (!Number.isFinite(event.loss) || event.loss < 0 || event.loss > 1)) throw new Error('Invalid packet loss');
    if (event.type === 'PARTITION_ON' && (!event.normal.every(Number.isFinite) || event.normal.every(v => v === 0) || !event.point.every(Number.isFinite))) throw new Error('Invalid partition plane');
    if (event.type === 'INJECT_SCORE' && (!Number.isInteger(event.droneId) || event.droneId < 0 || event.droneId >= params.n0)) throw new Error('Invalid injection target');
    const queue = events.get(event.tick) ?? [];
    queue.push(clone(event));
    events.set(event.tick, queue);
  }
  for (const event of source.events ?? []) schedule(event);

  function step(): WorldSnapshot {
    tick++;
    const uplinks: Pending[] = [];
    // 1. Environment events affect sensing and transmission on this same tick.
    for (const event of events.get(tick) ?? []) {
      if (event.type === 'KILL') for (const id of event.ids) {
        const body = bodies[id];
        if (body?.alive) { body.alive = false; body.diedTick = tick; }
      }
      if (event.type === 'JAM_ON') jams.set(event.id, { id: event.id, centre: clone(event.centre), radius: event.radius });
      if (event.type === 'JAM_OFF') jams.delete(event.id);
      if (event.type === 'PARTITION_ON') {
        const groups: (0 | 1)[] = bodies.map(body => {
          const rel = subtract(body.pos, event.point);
          return rel[0] * event.normal[0] + rel[1] * event.normal[1] + rel[2] * event.normal[2] < 0 ? 0 : 1;
        });
        partitions.set(event.id, { id: event.id, point: clone(event.point), normal: clone(event.normal), groups });
      }
      if (event.type === 'PARTITION_OFF') partitions.delete(event.id);
      if (event.type === 'SET_LOSS') loss = event.loss;
      if (event.type === 'INJECT_SCORE') uplinks.push({ receiver: event.droneId, message: freeze({
        type: 'SCORE', from: OPERATOR, seq: operatorSeq++, sentTick: tick, score: clone(event.score),
      }) });
    }
    events.delete(tick);
    const live = bodies.filter(b => b.alive).map(b => b.id);
    // 2. In-flight messages survive sender death. Dead receivers discard delivery.
    const inboxes: Message[][] = bodies.map(() => []);
    for (const delivery of uplinks) if (bodies[delivery.receiver].alive) inboxes[delivery.receiver].push(delivery.message);
    for (const delivery of pending.get(tick) ?? []) if (bodies[delivery.receiver].alive) inboxes[delivery.receiver].push(delivery.message);
    pending.delete(tick);
    for (const inbox of inboxes) inbox.sort((a, b) => a.sentTick - b.sentTick || a.from - b.from || a.seq - b.seq);
    // 3. Build all inputs before deciding or integrating any body.
    const grid = new SpatialGrid(bodies.map(b => b.pos), live, Math.max(params.rSense, params.rRadio));
    const inputs = new Map<number, AgentInput>();
    for (const id of live) {
      const body = bodies[id];
      const input: AgentInput = {
        tick, pos: clone(body.pos), vel: clone(body.vel), inbox: inboxes[id],
        sensed: grid.within(body.pos, params.rSense).filter(peer => peer !== id).map(peer => ({
          rel: subtract(bodies[peer].pos, body.pos), vel: subtract(bodies[peer].vel, body.vel),
        })),
      };
      inputs.set(id, test.freezeInputs ? freeze(input) : input);
    }
    // 4. Brains only get their private state and detached, local input.
    const outputs = new Map<number, AgentOutput>();
    for (const id of test.reverseStepOrder ? [...live].reverse() : live) {
      const input = inputs.get(id)!;
      const output = clone(brain.step(bodies[id].state, input));
      if (output.accel.length !== 3 || !output.accel.every(Number.isFinite)) throw new Error('Brain returned invalid acceleration');
      outputs.set(id, output);
      bodies[id].last = { input, output };
    }
    // 5. Sender/receiver ordering is independent of the brain invocation order.
    const radio: RadioEvent[] = [];
    const activeJams = [...jams.values()];
    const activePartitions = [...partitions.values()];
    const isJammed = bodies.map(body => activeJams.some(j => distanceSquared(body.pos, j.centre) <= j.radius ** 2));
    for (const id of live) for (const message of outputs.get(id)!.outbox) {
      if (message.from !== id || message.sentTick !== tick) throw new Error('Brain broadcast must identify its actual sender and current tick');
      const log: RadioEvent = { tick, from: id, type: message.type, claimSlot: message.type === 'HB' ? message.claim?.slot ?? null : null, delivered: [], lost: 0, jammed: 0, partitioned: 0 };
      // One immutable packet per broadcast; recipients cannot change each other's
      // inbox content. Delivery lists/brain inbox arrays remain private.
      const packet = freeze(clone(message));
      for (const receiver of grid.within(bodies[id].pos, params.rRadio)) {
        if (receiver === id) continue;
        if (isJammed[id] || isJammed[receiver]) { log.jammed++; continue; }
        if (activePartitions.some(partition => partition.groups[id] !== partition.groups[receiver])) { log.partitioned++; continue; }
        if (rng() < loss) { log.lost++; continue; }
        const latency = params.latencyMin + Math.floor(rng() * (params.latencyMax - params.latencyMin + 1));
        const queue = pending.get(tick + latency) ?? [];
        queue.push({ receiver, message: packet });
        pending.set(tick + latency, queue);
        log.delivered.push(receiver);
      }
      radio.push(log);
    }
    // 6. Semi-implicit Euler; ground contact removes downward velocity.
    for (const id of live) {
      const body = bodies[id];
      const acceleration = clampLength(outputs.get(id)!.accel, params.aMax);
      body.vel = clampLength(body.vel.map((v, axis) => v + acceleration[axis] * DT) as Vec3, params.vMax);
      body.pos = body.pos.map((v, axis) => v + body.vel[axis] * DT) as Vec3;
      if (body.pos[1] < 0) { body.pos[1] = 0; body.vel[1] = Math.max(0, body.vel[1]); }
      body.colour = clone(outputs.get(id)!.colour);
    }
    // 7. Entry events, not one event per tick spent in contact. Endpoint sampling.
    const afterGrid = new SpatialGrid(bodies.map(b => b.pos), live, Math.max(params.rSense, params.dCollide, params.dNear));
    const collisions: [number, number][] = [];
    const nearMisses: [number, number][] = [];
    const nowCollision = new Set<string>();
    const nowNear = new Set<string>();
    for (const id of live) for (const peer of afterGrid.within(bodies[id].pos, Math.max(params.dCollide, params.dNear))) {
      if (peer <= id) continue;
      const key = `${id},${peer}`;
      const d2 = distanceSquared(bodies[id].pos, bodies[peer].pos);
      if (d2 < params.dCollide ** 2) { nowCollision.add(key); if (!collisionPairs.has(key)) collisions.push([id, peer]); }
      if (d2 < params.dNear ** 2) { nowNear.add(key); if (!nearPairs.has(key)) nearMisses.push([id, peer]); }
    }
    collisionPairs = nowCollision;
    nearPairs = nowNear;
    // 8. Snapshot vectors and beliefs never alias a body or brain state.
    return {
      tick, drones: bodies.map(body => ({
        id: body.id, alive: body.alive, diedTick: body.diedTick, pos: clone(body.pos), vel: clone(body.vel), colour: clone(body.colour),
        partitionSide: activePartitions.length === 1 ? activePartitions[0].groups[body.id] : null, belief: clone(brain.belief(body.state)),
      })), radio, jams: clone([...jams.values()]), partitions: activePartitions.map(({ id, point, normal }) => ({ id, point: clone(point), normal: clone(normal) })), collisions, nearMisses,
    };
  }
  return {
    config, step, schedule,
    inspect(id) {
      const body = bodies[id];
      return body?.last ? clone({ ...body.last, state: body.state }) : null;
    },
    stateHash() {
      return hashText(JSON.stringify({ seed: config.seed, tick, bodies: bodies.map(({ id, alive, diedTick, pos, vel, colour, state }) => ({ id, alive, diedTick, pos, vel, colour, state })) }));
    },
  };
}
