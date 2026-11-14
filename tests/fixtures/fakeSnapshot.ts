// tests/fixtures/fakeSnapshot.ts
// A deterministic WorldSnapshot for building the renderer, the inspector and the observer before the real world exists.
// FAKE DATA: nothing here comes from a simulation. Use it in tests and development only, never in the demo.
// No Math.random: the same (tick, n0) always gives the same snapshot. tick is a non-negative integer.
import { DEFAULT_PARAMS, DT, OPERATOR } from '../../src/contracts';
import type { Belief, DroneSnap, RadioEvent, RGB, Vec3, WorldSnapshot } from '../../src/contracts';

const CENTRE: Vec3 = [0, 30, 0];
const RADIUS = 15;                                    // metres
const OMEGA = 0.1;                                    // rad/s about the y axis: one turn in about a minute
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const DEAD_ID = 3;                                    // this drone died at tick 0
const CLAIM_CYCLE = 200;                              // the highest id claims the dead drone's slot
const CLAIM_FROM = 100;                               //   during ticks [100, 120) of every 200
const CLAIM_TO = CLAIM_FROM + DEFAULT_PARAMS.claimWindow;
const SETTLED_TICK = DEFAULT_PARAMS.holdGrace + DEFAULT_PARAMS.tStable;

/** Direction of drone i on the unit sphere (Fibonacci lattice), turned by `angle` about y. */
function unit(i: number, n0: number, angle: number): Vec3 {
  const y = 1 - (2 * (i + 0.5)) / n0;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = i * GOLDEN_ANGLE + angle;
  return [r * Math.cos(phi), y, r * Math.sin(phi)];
}

function onSphere(u: Vec3): Vec3 {
  return [CENTRE[0] + RADIUS * u[0], CENTRE[1] + RADIUS * u[1], CENTRE[2] + RADIUS * u[2]];
}

function inRadioRange(a: Vec3, b: Vec3): boolean {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return RADIUS * Math.sqrt(dx * dx + dy * dy + dz * dz) <= DEFAULT_PARAMS.rRadio;
}

/** Hue varies with the index; full brightness. */
function colourOf(i: number, n0: number): RGB {
  const h = (i / n0) * 6;
  const f = h - Math.floor(h);
  const lo = 0.2;
  const up = lo + (1 - lo) * f;
  const down = 1 - (1 - lo) * f;
  switch (Math.floor(h) % 6) {
    case 0: return [1, up, lo];
    case 1: return [down, 1, lo];
    case 2: return [lo, 1, up];
    case 3: return [lo, down, 1];
    case 4: return [up, lo, 1];
    default: return [1, lo, down];
  }
}

function isDead(id: number): boolean {
  return id === DEAD_ID;
}

/** The claimant is the highest id, when the roster is big enough to have both it and the dead drone. */
function isClaiming(id: number, tick: number, n0: number): boolean {
  if (n0 < DEAD_ID + 2 || id !== n0 - 1) return false;
  const phase = tick % CLAIM_CYCLE;
  return phase >= CLAIM_FROM && phase < CLAIM_TO;
}

export function makeFakeSnapshot(tick: number, n0: number): WorldSnapshot {
  const angle = OMEGA * tick * DT;
  const units: Vec3[] = [];
  for (let i = 0; i < n0; i++) units.push(unit(i, n0, angle));

  const drones: DroneSnap[] = units.map((u, id): DroneSnap => {
    if (isDead(id)) {
      // Fell out of the show at tick 0: lies dark on the ground under where it was.
      const last = onSphere(unit(id, n0, 0));
      const belief: Belief = {
        slot: id, heldSince: 0,
        target: last,
        version: { issuedTick: 0, origin: OPERATOR },
        deaf: false,
        canHeal: false,
        claiming: null,
        peersKnown: 0,
        log: [`t=0 launch slot ${id}`],
      };
      return {
        id, alive: false, diedTick: 0,
        pos: [last[0], 0, last[2]], vel: [0, 0, 0], colour: [0, 0, 0],
        partitionSide: null,
        belief,
      };
    }

    const pos = onSphere(u);
    const claiming = isClaiming(id, tick, n0);
    let peersKnown = 0;
    units.forEach((v, other) => {
      if (other !== id && !isDead(other) && inRadioRange(u, v)) peersKnown += 1;
    });
    const log = [`t=0 launch slot ${id}`];
    if (claiming) log.push(`t=${tick - (tick % CLAIM_CYCLE) + CLAIM_FROM} claim slot ${DEAD_ID}`);
    const belief: Belief = {
      slot: id, heldSince: 0,
      target: [pos[0], pos[1], pos[2]],
      version: { issuedTick: 0, origin: OPERATOR },
      deaf: false,
      canHeal: tick >= SETTLED_TICK,
      claiming: claiming ? DEAD_ID : null,
      peersKnown,
      log,
    };
    return {
      id, alive: true, diedTick: null,
      pos,
      vel: [-RADIUS * OMEGA * u[2], 0, RADIUS * OMEGA * u[0]],   // tangent to the rotation
      colour: colourOf(id, n0),
      partitionSide: null,
      belief,
    };
  });

  // Two broadcasts per tick, three on every third tick. Senders walk round the roster, skipping the dead drone.
  const wanted = tick % 3 === 0 ? 3 : 2;
  const senders: number[] = [];
  const claimant = n0 - 1;
  if (isClaiming(claimant, tick, n0) && tick % DEFAULT_PARAMS.hbPeriod === claimant % DEFAULT_PARAMS.hbPeriod) {
    senders.push(claimant);                             // its heartbeat tick: the claim is on the air
  }
  for (let k = 0; k < n0 && senders.length < wanted; k++) {
    const id = (tick * 3 + k) % n0;
    if (!isDead(id) && !senders.includes(id)) senders.push(id);
  }

  const radio: RadioEvent[] = senders.map((from, k): RadioEvent => {
    const type: 'HB' | 'SCORE' = k === 2 && tick % 60 === 0 ? 'SCORE' : 'HB';
    const u = unit(from, n0, angle);
    const delivered: number[] = [];
    let lost = 0;
    units.forEach((v, to) => {
      if (to === from || isDead(to) || !inRadioRange(u, v)) return;
      if ((to * 7 + from * 3 + tick) % 20 === 0) lost += 1;     // about 5% of in-range receivers
      else delivered.push(to);
    });
    return {
      tick, from, type,
      claimSlot: type === 'HB' && isClaiming(from, tick, n0) ? DEAD_ID : null,
      delivered,
      lost, jammed: 0, partitioned: 0,
    };
  });

  return {
    tick,
    drones,
    radio,
    jams: [],
    partitions: [],
    collisions: [],
    nearMisses: [],
  };
}
