/**
 * All sound is synthesised with WebAudio — no samples to download.
 * Browsers only allow audio after a click/keypress on the page, so `unlock()`
 * must be called from a user gesture on the desktop.
 */

const PENTATONIC = [0, 2, 4, 7, 9];
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
/** Step `i` of a major pentatonic scale rooted at MIDI note `root`. */
const penta = (root: number, i: number) => midi(root + 12 * Math.floor(i / 5) + PENTATONIC[((i % 5) + 5) % 5]);

interface ToneOpts {
  type?: OscillatorType;
  to?: number;
  delay?: number;
  attack?: number;
}
interface NoiseOpts {
  type?: BiquadFilterType;
  to?: number;
  q?: number;
  delay?: number;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private chimeIn = 2.5;
  private _muted = false;

  get unlocked() {
    return !!this.ctx && this.ctx.state === 'running';
  }
  get muted() {
    return this._muted;
  }

  setMuted(m: boolean) {
    this._muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.03);
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = this._muted ? 0 : 0.9;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ctx.destination);
      this.master = master;

      // Dry bus + a soft feedback delay for a sense of open air.
      const bus = ctx.createGain();
      bus.connect(master);
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.27;
      const fb = ctx.createGain();
      fb.gain.value = 0.3;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      const wet = ctx.createGain();
      wet.gain.value = 0.2;
      bus.connect(delay);
      delay.connect(lp);
      lp.connect(fb);
      fb.connect(delay);
      lp.connect(wet);
      wet.connect(master);
      this.bus = bus;

      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;

      this.startWind();
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }

  /** Called every frame: schedules the occasional far-off wind chime. */
  update(dt: number) {
    if (!this.unlocked) return;
    this.chimeIn -= dt;
    if (this.chimeIn <= 0) {
      this.chimeIn = 2.8 + Math.random() * 4.5;
      const i = Math.floor(Math.random() * 8);
      this.tone(penta(72, i), 1.6, 0.022, { type: 'sine' });
      if (Math.random() < 0.4) this.tone(penta(72, i + 2), 1.4, 0.016, { type: 'sine', delay: 0.18 });
    }
  }

  // ------------------------------------------------------------- primitives

  private tone(f: number, dur: number, gain: number, o: ToneOpts = {}) {
    const ctx = this.ctx;
    if (!ctx || !this.bus || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(f, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + (o.attack ?? 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.bus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise(f: number, dur: number, gain: number, o: NoiseOpts = {}) {
    const ctx = this.ctx;
    if (!ctx || !this.bus || !this.noiseBuf || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = o.type ?? 'lowpass';
    filt.Q.value = o.q ?? 0.8;
    filt.frequency.setValueAtTime(f, t0);
    if (o.to) filt.frequency.exponentialRampToValueAtTime(Math.max(30, o.to), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.bus);
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.05);
  }

  private startWind() {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 420;
    filt.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0.028;
    // Slow LFO so the wind breathes.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.014;
    lfo.connect(lfoGain);
    lfoGain.connect(g.gain);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    src.start();
    lfo.start();
  }

  // ------------------------------------------------------------------ cues

  jump() {
    this.tone(300, 0.16, 0.16, { to: 640 });
    this.noise(900, 0.07, 0.04, { type: 'highpass' });
  }
  dash() {
    this.noise(500, 0.26, 0.14, { type: 'bandpass', to: 3200, q: 1.4 });
    this.tone(220, 0.2, 0.07, { type: 'triangle', to: 660 });
  }
  land(strength: number) {
    const s = Math.min(1, strength);
    this.noise(700, 0.1 + s * 0.08, 0.05 + s * 0.14, { to: 140 });
    this.tone(140, 0.12, 0.06 + s * 0.14, { to: 55 });
  }
  step() {
    this.noise(1800 + Math.random() * 600, 0.045, 0.018, { type: 'bandpass', q: 1.2 });
  }
  /** Each mote in a streak climbs the pentatonic scale. */
  mote(combo: number) {
    const f = penta(76, Math.min(combo, 14));
    this.tone(f, 0.42, 0.11, { type: 'triangle' });
    this.tone(f * 2, 0.3, 0.045);
    this.tone(f * 3, 0.14, 0.02);
  }
  bloom() {
    [0, 2, 4, 5, 7, 9].forEach((s, i) => {
      this.tone(penta(69, s), 0.7, 0.1, { type: 'triangle', delay: i * 0.075 });
      this.tone(penta(81, s), 0.5, 0.035, { delay: i * 0.075 });
    });
    this.noise(5000, 0.5, 0.03, { type: 'highpass' });
  }
  bounce(power: number) {
    const p = Math.min(1, Math.max(0, power));
    this.tone(150 + p * 60, 0.34, 0.2, { to: 420 + p * 520 });
    this.tone(300 + p * 120, 0.22, 0.07, { type: 'triangle', to: 900 + p * 700, delay: 0.02 });
  }
  crumbleWarn() {
    this.noise(320, 0.5, 0.11, { to: 180, q: 2 });
    this.tone(92, 0.4, 0.07, { type: 'triangle', to: 70 });
  }
  crumbleFall() {
    this.noise(900, 0.45, 0.14, { to: 90 });
  }
  crumbleBack() {
    this.tone(520, 0.18, 0.045, { type: 'triangle', to: 780 });
  }
  echo(aSolid: boolean) {
    const a = aSolid ? 62 : 67;
    this.tone(midi(a), 0.14, 0.07, { type: 'triangle' });
    this.tone(midi(a + 7), 0.2, 0.06, { type: 'triangle', delay: 0.07 });
  }
  checkpoint() {
    [60, 64, 67, 72].forEach((n, i) => this.tone(midi(n), 0.9, 0.08, { type: 'triangle', delay: i * 0.09 }));
  }
  fall() {
    this.tone(520, 0.5, 0.12, { to: 110 });
  }
  respawn() {
    this.tone(330, 0.25, 0.08, { type: 'triangle', to: 660 });
    this.tone(660, 0.3, 0.05, { delay: 0.1 });
  }
  finish() {
    const chords = [
      [60, 64, 67],
      [65, 69, 72],
      [67, 71, 74],
      [72, 76, 79, 84],
    ];
    chords.forEach((c, i) =>
      c.forEach((n) => this.tone(midi(n), i === 3 ? 2.2 : 0.5, 0.085, { type: 'triangle', delay: i * 0.24 })),
    );
    this.noise(6000, 1.4, 0.035, { type: 'highpass', delay: 0.72 });
  }
}
