// src/contracts/params.ts
// CONTRACT file (docs/design/contracts-and-algorithms.md, section 1). Change only through a [contract] PR.
export const DT = 0.05;                 // seconds per tick (20 Hz)
export const OPERATOR = -1;             // sender id of an operator uplink

export type Vec3 = [number, number, number];
export type RGB = [number, number, number];   // 0..1

export interface Params {
  n0: number;              // launch roster size                        200
  // geometry (m)
  slotSpacingMin: number;  // min distance between slots of a formation  1.5
  rOcc: number;            // "at the slot" tolerance                    0.6
  dAvoid: number;          // separation steering starts below this      1.4  (must be < slotSpacingMin)
  dCollide: number;        // collision is counted below this            0.4
  dNear: number;           // near-miss is counted below this            0.8
  rSense: number;          // sensing range                              8
  rRadio: number;          // radio range                                15
  rClaim: number;          // max distance to a slot a drone may claim   6    (must be <= rSense - rOcc)
  // motion
  vMax: number;            // m/s                                        8
  aMax: number;            // m/s^2                                      8
  // radio
  latencyMin: number;      // ticks                                      1
  latencyMax: number;      // ticks                                      2
  loss: number;            // packet loss probability per receiver       0.05
  // protocol (ticks)
  hbPeriod: number;        // heartbeat and scan period                  5    (4 Hz)
  tDeaf: number;           // no radio heard for this long => deaf       40
  tVacant: number;         // slot sensed empty for this long            40
  tSuspect: number;        // no heartbeat holding the slot for this long 60
  claimWindow: number;     // contention window before commit            20
  claimGap: number;        // claim only if v + claimGap < own slot      6    (= max(2, ceil(0.03 * n0)))
  tStable: number;         // own target unchanged for this long         120
  tSettle: number;         // at own slot and slow for this long         20
  holdGrace: number;       // wait after a movement's hold starts        40
  yieldTicks: number;      // physical yield: slot seen occupied this long 20
  historyMax: number;      // max remembered previous slots              8
  scoreLead: number;       // new movement starts this long after injection 60
  scoreResendMin: number;  // min gap between SCORE sends per drone      40
  scoreJitter: number;     // random delay before a SCORE send (0..n-1)  10
  transitLanes: boolean;   // SHOULD feature, see section 10             false
}

// the values above, for n0 = 200
export const DEFAULT_PARAMS: Params = {
  n0: 200,
  // geometry (m)
  slotSpacingMin: 1.5,
  rOcc: 0.6,
  dAvoid: 1.4,
  dCollide: 0.4,
  dNear: 0.8,
  rSense: 8,
  rRadio: 15,
  rClaim: 6,
  // motion
  vMax: 8,
  aMax: 8,
  // radio
  latencyMin: 1,
  latencyMax: 2,
  loss: 0.05,
  // protocol (ticks)
  hbPeriod: 5,
  tDeaf: 40,
  tVacant: 40,
  tSuspect: 60,
  claimWindow: 20,
  claimGap: 6,
  tStable: 120,
  tSettle: 20,
  holdGrace: 40,
  yieldTicks: 20,
  historyMax: 8,
  scoreLead: 60,
  scoreResendMin: 40,
  scoreJitter: 10,
  transitLanes: false,
};

// sets n0 and claimGap = max(2, ceil(0.03 * n0)), then applies overrides
export function makeParams(n0: number, overrides?: Partial<Params>): Params {
  return {
    ...DEFAULT_PARAMS,
    n0,
    claimGap: Math.max(2, Math.ceil(0.03 * n0)),
    ...overrides,
  };
}
