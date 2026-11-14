/**
 * One Euro filter (Casiez et al.) — an adaptive low-pass filter.
 * Slow movements get heavy smoothing (no jitter at rest); fast movements
 * raise the cutoff so the output keeps up (no perceptible lag).
 */

const alpha = (dt: number, cutoff: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuro {
  private ready = false;
  private lastT = 0;
  private prevRaw = 0;
  private x = 0;
  private dx = 0;
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;

  /**
   * @param minCutoff Hz — lower = smoother at rest
   * @param beta      speed coefficient — higher = less lag when moving fast
   * @param dCutoff   Hz — cutoff for the derivative estimate
   */
  constructor(minCutoff = 1.5, beta = 0.04, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  reset() {
    this.ready = false;
  }

  filter(value: number, tMs: number): number {
    if (!this.ready) {
      this.ready = true;
      this.lastT = tMs;
      this.prevRaw = value;
      this.x = value;
      this.dx = 0;
      return value;
    }
    const dt = Math.max(1 / 240, (tMs - this.lastT) / 1000);
    this.lastT = tMs;

    const rawD = (value - this.prevRaw) / dt;
    this.prevRaw = value;
    this.dx += (rawD - this.dx) * alpha(dt, this.dCutoff);

    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += (value - this.x) * alpha(dt, cutoff);
    return this.x;
  }
}
