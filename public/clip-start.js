export function randomClipStart(duration, random = Math.random) {
  if (!Number.isFinite(duration) || duration <= 0.1) return 0;
  // Preserve every guessing stage when the audio is long enough. Short previews
  // still get a random point; their longest clips stop at the available end.
  const reserve = duration >= 16 ? 15 : Math.max(0.1, duration / 2);
  const maximum = duration - reserve;
  const minimum = Math.min(1, maximum / 2);
  return minimum + Math.max(0, Math.min(1, random())) * (maximum - minimum);
}
