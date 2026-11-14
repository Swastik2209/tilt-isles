/**
 * Every number that shapes how Pip feels lives here.
 * Units: metres, seconds. Pip is roughly 1.05 m tall.
 */
export const T = {
  /** Fixed physics step. */
  STEP: 1 / 120,

  RADIUS: 0.36,
  HEIGHT: 1.05,

  // --- Ground movement: quick to answer, a little weight when stopping.
  MAX_SPEED: 7.2,
  GROUND_ACCEL: 46,
  GROUND_DECEL: 52,
  /** Extra push when the stick opposes current velocity — snappy turnarounds. */
  TURN_ACCEL: 84,

  // --- Air control: real, but clearly less than on the ground.
  AIR_ACCEL: 26,
  AIR_DECEL: 7,

  // --- Jump arc: fast up, faster down, a breath of hang at the top.
  JUMP_V: 13.5,
  GRAV_UP: 34,
  GRAV_DOWN: 54,
  /** Gravity multiplier while rising with jump released (variable height). */
  CUT_MULT: 2.6,
  HANG_V: 2.0,
  HANG_MULT: 0.55,
  TERMINAL: 34,

  // --- Forgiveness.
  COYOTE: 0.11,
  BUFFER: 0.15,
  /** How far below a ledge Pip's feet can be and still get pulled up onto it. */
  LEDGE: 0.28,
  /** Keeps Pip glued to ground that drops away slightly (slopes, lifts). */
  SNAP: 0.26,
  /** How far Pip's centre may overhang an edge before falling. */
  EDGE_MARGIN: 0.2,

  // --- Mid-air spin dash.
  DASH_SPEED: 13,
  DASH_TIME: 0.2,
  DASH_UP: 6.5,

  // --- Landing recovery after a heavy fall.
  HARD_LAND: 21,
  RECOVER_TIME: 0.11,
  RECOVER_MULT: 0.55,

  // --- Collectibles.
  MAGNET_R: 2.3,
  COLLECT_R: 0.6,
};
