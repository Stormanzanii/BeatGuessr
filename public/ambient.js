// The album-art backdrop, drawn on a tiny canvas and stretched to fill the
// window. Earlier versions built it from oversized, rotating, blurred CSS
// layers inside a filtered, scaled container; browsers flickered black and
// washed elements out white while compositing that. Here the blur, colour
// and motion all happen inside a ~120px canvas, and the page only ever
// composites one plain image.
const WIDTH = 120;
const HEIGHT = 68;
const FRAME_MS = 1000 / 30;
const FADE_MS = 1200;
const FALLBACK = [
  [0.22, 0.3, "#ff3d68"],
  [0.78, 0.7, "#7b4dff"],
  [0.62, 0.18, "#ff9d3d"],
  [0.3, 0.85, "#c13bff"],
];
// Matches the old CSS backdrop's saturate(2.2) brightness(0.62), lifted a
// little because the canvas blur averages colours down more.
const FILTER = "blur(5px) saturate(2.4) brightness(0.78)";

class Ambient {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    this.current = null;
    this.previous = null;
    this.fadeStart = 0;
    this.last = 0;
    this.still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  async setCover(url) {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      return;
    }
    this.previous = this.current;
    this.current = image;
    this.fadeStart = performance.now();
    if (this.still) this.draw(performance.now());
  }

  visible() {
    return (
      !document.hidden &&
      getComputedStyle(this.canvas.parentElement).display !== "none"
    );
  }

  loop(now) {
    requestAnimationFrame(this.loop);
    if (now - this.last < FRAME_MS) return;
    // Check visibility once a second; themes without a backdrop cost nothing.
    if (now - (this.checked ?? -Infinity) > 1000) {
      this.checked = now;
      this.shown = this.visible();
    }
    if (!this.shown) return;
    if (this.still && this.drawn && now - this.fadeStart > FADE_MS) return;
    this.last = now;
    this.draw(now);
    this.drawn = true;
    if (now - (this.tinted ?? -Infinity) > 1000) {
      this.tinted = now;
      this.tintPage();
    }
  }

  // Match the page's base colour to the backdrop's average, so if a browser
  // ever drops the backdrop layer for a frame, what shows through is the
  // same hue instead of near-black.
  tintPage() {
    try {
      this.sampler ??= Object.assign(document.createElement("canvas"), {
        width: 1,
        height: 1,
      });
      const ctx = this.sampler.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(this.canvas, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      document.documentElement.style.backgroundColor = `rgb(${r} ${g} ${b})`;
    } catch {}
  }

  // Three copies of the art, turning slowly in different directions, the way
  // Spicy Lyrics layers its background.
  paintArt(image, time, alpha) {
    const ctx = this.context;
    // Big enough that each turning copy sweeps colour across the screen.
    const size = WIDTH * 2.6;
    const layers = [
      [0.68, 0.3, 1, 0.9],
      [0.28, 0.72, -0.8, 1],
      [0.9, 0.95, -0.55, 0.8],
    ];
    for (const [x, y, speed, opacity] of layers) {
      ctx.save();
      ctx.globalAlpha = alpha * opacity;
      ctx.translate(x * WIDTH, y * HEIGHT);
      ctx.rotate(this.still ? 0 : (time / 32000) * Math.PI * 2 * speed);
      ctx.drawImage(image, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
  }

  paintFallback(time, alpha) {
    const ctx = this.context;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#3a1f63";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    for (const [i, [x, y, colour]] of FALLBACK.entries()) {
      const drift = this.still ? 0 : Math.sin(time / 7000 + i * 2) * 0.14;
      const cx = (x + drift) * WIDTH;
      const cy = (y - drift * 0.8) * HEIGHT;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, WIDTH * 0.75);
      glow.addColorStop(0, colour);
      glow.addColorStop(1, `${colour}00`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    ctx.globalAlpha = 1;
  }

  draw(time) {
    const ctx = this.context;
    ctx.filter = FILTER;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const fade = Math.min(1, (time - this.fadeStart) / FADE_MS);
    if (this.previous && fade < 1) this.paintArt(this.previous, time, 1);
    else if (!this.previous && this.current && fade < 1)
      this.paintFallback(time, 1);
    if (this.current) this.paintArt(this.current, time, fade);
    else this.paintFallback(time, 1);
    if (fade >= 1) this.previous = null;
    ctx.filter = "none";
  }
}

let ambient;
export function ambientBackdrop() {
  if (ambient) return ambient;
  const canvas = document.querySelector(".ambient-canvas");
  if (canvas) ambient = new Ambient(canvas);
  return ambient;
}
