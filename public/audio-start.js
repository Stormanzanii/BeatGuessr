const analyses = new WeakMap();

function waveform(buffer) {
  if (analyses.has(buffer)) return analyses.get(buffer);
  const blockSize = Math.max(1, Math.round(buffer.sampleRate * 0.01));
  const levels = new Float32Array(Math.ceil(buffer.length / blockSize));
  let peak = 0,
    loudest = 0;
  // Check channels separately: opposite-phase stereo must not cancel out.
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let block = 0; block < levels.length; block++) {
      const start = block * blockSize,
        end = Math.min(samples.length, start + blockSize);
      let energy = 0;
      for (let frame = start; frame < end; frame++)
        energy += samples[frame] * samples[frame];
      levels[block] = Math.max(
        levels[block],
        Math.sqrt(energy / (end - start)),
      );
      if (levels[block] > peak) {
        peak = levels[block];
        loudest = block;
      }
    }
  }
  if (peak < 0.0001)
    throw new Error(
      "This audio is silent or too quiet. Try another preview or song.",
    );
  const threshold = Math.max(peak * 0.025, Math.min(0.003, peak * 0.25));
  const active = new Uint32Array(levels.length + 1);
  for (let index = 0; index < levels.length; index++)
    active[index + 1] = active[index] + Number(levels[index] >= threshold);
  const result = {
    levels,
    active,
    threshold,
    loudest,
    step: blockSize / buffer.sampleRate,
  };
  analyses.set(buffer, result);
  return result;
}

export function audibleClipStart(buffer, preferred = 0) {
  const { levels, active, threshold, loudest, step } = waveform(buffer);
  const maximum = Math.max(0, buffer.duration - 0.1);
  const start = Math.max(0, Math.min(maximum, preferred));
  const good = (index) => {
    const end = Math.min(levels.length, index + Math.ceil(0.1 / step));
    return (
      levels[index] >= threshold &&
      active[end] - active[index] >= Math.min(3, end - index)
    );
  };
  if (good(Math.floor(start / step))) return start;
  // Prefer a point that still leaves enough audio for the full 15-second stage.
  const reservedMaximum =
    buffer.duration >= 16 ? buffer.duration - 15 : maximum;
  const scan = (from, to) => {
    for (
      let index = Math.ceil(from / step);
      index <= Math.floor(to / step);
      index++
    )
      if (good(index)) return index * step;
    return null;
  };
  const chosen =
    scan(start, reservedMaximum) ??
    scan(0, Math.min(start, reservedMaximum)) ??
    scan(reservedMaximum, maximum);
  // A very short transient may be the only sound in a file; include it rather than silence.
  return chosen ?? Math.min(maximum, loudest * step);
}
