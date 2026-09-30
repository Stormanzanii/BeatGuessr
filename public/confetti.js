let cancelCurrent = () => {};
export function confettiMultiplier(value = 6) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(1, Math.min(20, Math.round(number)))
    : 6;
}

export function celebrate(multiplier = 6) {
  cancelCurrent();
  const canvas = document.createElement("canvas");
  canvas.className = "confetti";
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);
  const context = canvas.getContext("2d");
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const width = innerWidth,
    height = innerHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  context.scale(dpr, dpr);
  const colors = [
    "#c5f46b",
    "#fc7189",
    "#78c8ff",
    "#ffe278",
    "#c096ff",
    "#ffffff",
    "#ff9f64",
  ];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const intensity = confettiMultiplier(multiplier);
  const total = reduced ? 110 : 1500 * intensity;
  const volleySize = total / 5;
  const duration = reduced ? 2 : Math.min(12, intensity * 2);
  const particles = Array.from({ length: total }, (_, i) => {
    const fromTop = i % 2 === 0;
    const left = i % 4 === 1;
    return {
      x: fromTop ? Math.random() * width : left ? -15 : width + 15,
      y: fromTop
        ? -20 - Math.random() * height * 0.3
        : height * (0.35 + Math.random() * 0.65),
      vx: fromTop
        ? (Math.random() - 0.5) * 190
        : (left ? 1 : -1) * (350 + Math.random() * width * 0.85),
      vy: fromTop ? 100 + Math.random() * 160 : -300 - Math.random() * 650,
      size: 8 + Math.random() * 12,
      spin: (Math.random() - 0.5) * 13,
      angle: Math.random() * 7,
      // Five overlapping volleys, with a large burst immediately on the win.
      delay: reduced
        ? Math.random() * 0.3
        : Math.floor(i / volleySize) * (duration * 0.0875) +
          Math.random() * (duration * 0.025),
      color: colors[i % colors.length],
    };
  });
  canvas.dataset.particles = String(total);
  canvas.dataset.multiplier = String(intensity);
  canvas.dataset.duration = String(duration);
  let frame,
    last = performance.now();
  const started = last;
  const clear = () => {
    cancelAnimationFrame(frame);
    canvas.remove();
  };
  cancelCurrent = clear;
  function render(now) {
    const elapsed = (now - started) / 1000,
      dt = Math.min((now - last) / 1000, 0.04);
    last = now;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.globalAlpha = Math.max(
      0,
      Math.min(1, (duration - elapsed) / Math.min(1.5, duration * 0.2)),
    );
    for (const p of particles) {
      if (elapsed < p.delay) continue;
      p.vx *= Math.pow(0.6, dt);
      p.vy += 185 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      if (p.y > height + 40) continue;
      const cosine = Math.cos(p.angle),
        sine = Math.sin(p.angle);
      // Avoid thousands of save/restore pairs per frame during dense bursts.
      context.setTransform(
        dpr * cosine,
        dpr * sine,
        -dpr * sine,
        dpr * cosine,
        dpr * p.x,
        dpr * p.y,
      );
      context.fillStyle = p.color;
      context.fillRect(
        -p.size / 2,
        -p.size / 3,
        p.size,
        p.size * 0.65 * Math.cos(p.angle),
      );
    }
    if (elapsed < duration) frame = requestAnimationFrame(render);
    else clear();
  }
  frame = requestAnimationFrame(render);
}
