// A ring of frequency bars drawn around the record while a clip plays.
// The canvas sits beside the record rather than inside it, so it holds still
// while the record spins; it is sized to the record every frame, so it
// follows layout changes and theme switches without any wiring.
const BARS = 64;
const DECAY = 0.86;

export class RecordVisualizer {
  constructor(canvas, record, player) {
    this.canvas = canvas;
    this.record = record;
    this.player = player;
    this.context = canvas?.getContext("2d");
    this.levels = new Float32Array(BARS);
    this.frame = 0;
    this.tick = 0;
  }

  start() {
    if (!this.context || this.frame) return;
    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      if (!this.draw()) this.stop();
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.levels.fill(0);
    if (!this.canvas) return;
    // Collapse it, so a ring sized for an earlier, wider layout can't widen
    // the page after a resize.
    this.canvas.width = this.canvas.height = 0;
    this.canvas.style.width = this.canvas.style.height = "0px";
  }

  // Theme colour, re-read now and then so a theme switch is picked up.
  // Glow is left to CSS: canvas shadowBlur on every frame was costly enough
  // to stall playback on machines without GPU rasterisation.
  readColours() {
    const style = getComputedStyle(this.canvas);
    this.colour = style.getPropertyValue("--viz-color").trim() || "#fff";
  }

  place() {
    const size = this.record.offsetWidth;
    if (!size) return 0;
    const span = Math.round(size * 1.5);
    const dpr = Math.min(2, devicePixelRatio || 1);
    const style = this.canvas.style;
    style.width = style.height = `${span}px`;
    style.left = `${this.record.offsetLeft + size / 2 - span / 2}px`;
    style.top = `${this.record.offsetTop + size / 2 - span / 2}px`;
    if (this.canvas.width !== Math.round(span * dpr)) {
      this.canvas.width = this.canvas.height = Math.round(span * dpr);
    }
    return { size, span, dpr };
  }

  sample() {
    const analyser = this.player.analyser;
    if (!analyser || !this.player.playing) return false;
    if (!this.bins || this.bins.length !== analyser.frequencyBinCount)
      this.bins = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(this.bins);
    // Half the ring, mirrored: bar i reads a bin spaced on a curve so the
    // low end, where most energy sits, doesn't fill every bar.
    const half = BARS / 2;
    const usable = this.bins.length * 0.7;
    for (let i = 0; i < half; i++) {
      const bin = Math.floor(Math.pow(i / half, 1.6) * usable);
      const value = this.bins[bin] / 255;
      this.levels[i] = Math.max(value, this.levels[i] * DECAY);
      this.levels[BARS - 1 - i] = this.levels[i];
    }
    return true;
  }

  // Returns false once there is nothing left to show.
  draw() {
    if (this.tick++ % 30 === 0) this.readColours();
    const playing = this.sample();
    if (!playing) for (let i = 0; i < BARS; i++) this.levels[i] *= DECAY;
    const peak = Math.max(...this.levels);
    if (!playing && peak < 0.01) return false;

    const box = this.place();
    if (!box) return true;
    const { size, span, dpr } = box;
    const ctx = this.context;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, span, span);
    const centre = span / 2;
    const inner = size / 2 + Math.max(4, size * 0.02);
    const reach = size * 0.2;
    const width = Math.max(2, ((Math.PI * 2 * inner) / BARS) * 0.4);
    ctx.lineCap = "round";
    ctx.lineWidth = width;
    ctx.strokeStyle = this.colour;
    ctx.beginPath();
    for (let i = 0; i < BARS; i++) {
      const length = 2 + this.levels[i] * reach;
      const angle = (i / BARS) * Math.PI * 2 - Math.PI / 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx.moveTo(centre + cos * inner, centre + sin * inner);
      ctx.lineTo(centre + cos * (inner + length), centre + sin * (inner + length));
    }
    ctx.stroke();
    return true;
  }
}
