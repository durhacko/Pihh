// PROTOTYPE FIXTURE — not production code.
// A copy of src/sim/world.ts (WP-2a, as on main 14 Nov ~20:15) extended with the three events main's world
// still rejects: PARTITION_ON/OFF, INJECT_SCORE and SET_LOSS, implemented as contract §5 describes them.
// It returns real contract types (WorldSnapshot, RadioEvent) so the UI is built against the contract, not
// against this file. Delete it once #14 accepts every EnvEvent; the adapter then calls createWorld directly.
import { DT, OPERATOR } from '@encore/contracts';
import type { AgentInput, AgentOutput, EnvEvent, Message, RadioEvent, Vec3, World, WorldConfig, WorldSnapshot } from '@encore/contracts';
import { SpatialGrid } from '@encore/sim/grid';
import { clampLength, distanceSquared, launchPosition, subtract } from '@encore/sim/math';
import { createRandom, hashSeed, hashText } from '@encore/sim/random';

interface Body {
  id: number; alive: boolean; diedTick: number | null;
  pos: Vec3; vel: Vec3; colour: Vec3; state: unknown;
  last: { input: AgentInput; output: AgentOutput } | null;
}
interface Pending { receiver: number; message: Message }
type Jam = WorldSnapshot['jams'][number];
type Partition = WorldSnapshot['partitions'][number];

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(entry => clone(entry)) as T;
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) copy[key] = clone((value as Record<string, unknown>)[key]);
    return copy as T;
  }
  return value;
}

export function createFixtureWorld(source: WorldConfig): World {
  const params = clone(source.params);
  const score = clone(source.score);
  const brain = source.brain;
  const config = Object.freeze({ seed: source.seed, params, score, brain, events: clone(source.events ?? []) });
  const rng = createRandom(hashSeed(source.seed, -1));
  let tick = 0;
  let loss = params.loss;
  const bodies: Body[] = Array.from({ length: params.n0 }, (_, id) => ({
    id, alive: true, diedTick: null, pos: launchPosition(id, params.n0), vel: [0, 0, 0], colour: [0, 0, 0],
    state: clone(brain.init({ id, n0: params.n0, initialSlot: id, params: clone(params), score: clone(score), seed: hashSeed(source.seed, id) })),
    last: null,
  }));
  const events = new Map<number, EnvEvent[]>();
  const pending = new Map<number, Pending[]>();
  const jams = new Map<string, Jam>();
  const partitions = new Map<string, Partition>();
  let side: (0 | 1 | null)[] = bodies.map(() => null);
  let collisionPairs = new Set<string>();
  let nearPairs = new Set<string>();

  function schedule(event: EnvEvent) {
    if (!Number.isInteger(event.tick) || event.tick <= tick) throw new Error('Events must be scheduled after the current tick');
    const queue = events.get(event.tick) ?? [];
    queue.push(clone(event));
    events.set(event.tick, queue);
  }
  for (const event of source.events ?? []) schedule(event);

  function step(): WorldSnapshot {
    tick++;
    const injected: { id: number; message: Message }[] = [];
    for (const event of events.get(tick) ?? []) {
      if (event.type === 'KILL') for (const id of event.ids) {
        const body = bodies[id];
        if (body?.alive) { body.alive = false; body.diedTick = tick; }
      }
      if (event.type === 'JAM_ON') jams.set(event.id, { id: event.id, centre: clone(event.centre), radius: event.radius });
      if (event.type === 'JAM_OFF') jams.delete(event.id);
      if (event.type === 'PARTITION_ON') {
        // Groups are fixed at this tick, wherever drones fly afterwards (contract §5).
        partitions.clear();
        partitions.set(event.id, { id: event.id, point: clone(event.point), normal: clone(event.normal) });
        side = bodies.map(b => {
          const d = subtract(b.pos, event.point);
          return d[0] * event.normal[0] + d[1] * event.normal[1] + d[2] * event.normal[2] >= 0 ? 1 : 0;
        });
      }
      if (event.type === 'PARTITION_OFF') { partitions.delete(event.id); if (partitions.size === 0) side = bodies.map(() => null); }
      if (event.type === 'SET_LOSS') loss = Math.max(0, Math.min(1, event.loss));
      if (event.type === 'INJECT_SCORE') injected.push({ id: event.droneId, message: { type: 'SCORE', from: OPERATOR, seq: 0, sentTick: tick, score: clone(event.score) } });
    }
    events.delete(tick);
    const live = bodies.filter(b => b.alive).map(b => b.id);
    const inboxes: Message[][] = bodies.map(() => []);
    for (const delivery of pending.get(tick) ?? []) if (bodies[delivery.receiver].alive) inboxes[delivery.receiver].push(delivery.message);
    pending.delete(tick);
    // The uplink puts one ScoreMsg into that drone's inbox. Nothing else (contract §5).
    for (const { id, message } of injected) if (bodies[id]?.alive) inboxes[id].push(message);
    for (const inbox of inboxes) inbox.sort((a, b) => a.sentTick - b.sentTick || a.from - b.from || a.seq - b.seq);
    const grid = new SpatialGrid(bodies.map(b => b.pos), live, Math.max(params.rSense, params.rRadio));
    const inputs = new Map<number, AgentInput>();
    for (const id of live) {
      const body = bodies[id];
      inputs.set(id, {
        tick, pos: clone(body.pos), vel: clone(body.vel), inbox: inboxes[id],
        sensed: grid.within(body.pos, params.rSense).filter(peer => peer !== id).map(peer => ({
          rel: subtract(bodies[peer].pos, body.pos), vel: subtract(bodies[peer].vel, body.vel),
        })),
      });
    }
    const outputs = new Map<number, AgentOutput>();
    for (const id of live) {
      const input = inputs.get(id)!;
      const output = brain.step(bodies[id].state, input);
      outputs.set(id, output);
      bodies[id].last = { input, output };
    }
    const radio: RadioEvent[] = [];
    const activeJams = [...jams.values()];
    const isJammed = bodies.map(body => activeJams.some(j => distanceSquared(body.pos, j.centre) <= j.radius ** 2));
    const split = partitions.size > 0;
    for (const id of live) for (const message of outputs.get(id)!.outbox) {
      const log: RadioEvent = { tick, from: id, type: message.type, claimSlot: message.type === 'HB' ? message.claim?.slot ?? null : null, delivered: [], lost: 0, jammed: 0, partitioned: 0 };
      for (const receiver of grid.within(bodies[id].pos, params.rRadio)) {
        if (receiver === id) continue;
        if (isJammed[id] || isJammed[receiver]) { log.jammed++; continue; }
        if (split && side[id] !== side[receiver]) { log.partitioned++; continue; }
        if (rng() < loss) { log.lost++; continue; }
        const latency = params.latencyMin + Math.floor(rng() * (params.latencyMax - params.latencyMin + 1));
        const queue = pending.get(tick + latency) ?? [];
        queue.push({ receiver, message });
        pending.set(tick + latency, queue);
        log.delivered.push(receiver);
      }
      radio.push(log);
    }
    for (const id of live) {
      const body = bodies[id];
      const acceleration = clampLength(outputs.get(id)!.accel, params.aMax);
      body.vel = clampLength(body.vel.map((v, axis) => v + acceleration[axis] * DT) as Vec3, params.vMax);
      body.pos = body.pos.map((v, axis) => v + body.vel[axis] * DT) as Vec3;
      if (body.pos[1] < 0) { body.pos[1] = 0; body.vel[1] = Math.max(0, body.vel[1]); }
      body.colour = outputs.get(id)!.colour.slice() as Vec3;
    }
    const afterGrid = new SpatialGrid(bodies.map(b => b.pos), live, Math.max(params.dCollide, params.dNear, 1));
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
    return {
      tick, drones: bodies.map(body => ({
        id: body.id, alive: body.alive, diedTick: body.diedTick, pos: body.pos.slice() as Vec3, vel: body.vel.slice() as Vec3,
        colour: body.colour.slice() as Vec3, partitionSide: side[body.id], belief: clone(brain.belief(body.state)),
      })), radio, jams: clone([...jams.values()]), partitions: clone([...partitions.values()]), collisions, nearMisses,
    };
  }
  return {
    config, step, schedule,
    inspect(id) {
      const body = bodies[id];
      return body?.last ? clone({ ...body.last, state: body.state }) : null;
    },
    stateHash() {
      return hashText(JSON.stringify({ seed: config.seed, tick, bodies: bodies.map(({ id, alive, pos }) => ({ id, alive, pos })) }));
    },
  };
}
