import test from "node:test";
import assert from "node:assert/strict";
import { ClipPlayer } from "../public/audio.js";
import { randomClipStart } from "../public/clip-start.js";
import { audibleClipStart } from "../public/audio-start.js";

function audioBuffer(duration, signal, channels = 1) {
  const sampleRate = 1000,
    length = Math.round(duration * sampleRate);
  const data = Array.from({ length: channels }, (_, channel) =>
    Float32Array.from({ length }, (_, i) => signal(i / sampleRate, channel)),
  );
  return {
    duration,
    sampleRate,
    length,
    numberOfChannels: channels,
    getChannelData: (channel) => data[channel],
  };
}

test("random start chooses a nonzero point even on a 15-second preview", (t) => {
  const original = globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame = () => {};
  t.after(() => {
    globalThis.cancelAnimationFrame = original;
  });
  t.mock.method(Math, "random", () => 0.5);
  const player = new ClipPlayer(
    () => {},
    () => {},
  );
  player.setBuffer(
    audioBuffer(15, () => 0.2),
    true,
  );
  assert.ok(
    player.offset > 0,
    "Enabled random start must move into a short preview",
  );
  assert.ok(player.offset < 15);
  player.setStart(false);
  assert.equal(player.offset, 0);
});

test("waveform checks skip leading silence and silent random points", () => {
  const buffer = audioBuffer(30, (time) => (time >= 2 && time < 5 ? 0.3 : 0));
  assert.equal(audibleClipStart(buffer), 2);
  assert.equal(audibleClipStart(buffer, 10), 2);
  assert.equal(audibleClipStart(buffer, 3.125), 3.125);
  assert.equal(
    audibleClipStart(audioBuffer(30, (time) => (time > 27 ? 0.2 : 0))),
    27,
  );
});
test("waveform checks reject silence, ignore isolated clicks, and preserve stereo", () => {
  assert.throws(() => audibleClipStart(audioBuffer(30, () => 0)), /silent/);
  const stereo = audioBuffer(
    3,
    (time, channel) => (time >= 1 ? (channel ? -0.2 : 0.2) : 0),
    2,
  );
  assert.equal(audibleClipStart(stereo), 1);
  const clickThenMusic = audioBuffer(3, (time) =>
    time < 0.001 ? 1 : time >= 1 ? 0.2 : 0,
  );
  assert.equal(audibleClipStart(clickThenMusic), 1);
  assert.equal(audibleClipStart(audioBuffer(0.05, () => 0.1)), 0);
});

test("random start is bounded, preserves full stages on longer audio, and handles tiny clips", () => {
  for (const duration of [0, 0.05, 0.1])
    assert.equal(randomClipStart(duration), 0);
  for (const duration of [0.11, 1, 8, 15, 15.02, 16, 30, 180])
    for (const sample of [0, 0.5, 0.999999]) {
      const offset = randomClipStart(duration, () => sample);
      assert.ok(offset > 0 && offset <= duration - 0.1);
      if (duration >= 16) assert.ok(duration - offset >= 15);
    }
  assert.ok(randomClipStart(15.02, () => 0.5) > 1);
});

test("longer clips continue at the last audible position up to the new total", (t) => {
  const original = globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame = () => {};
  t.after(() => {
    globalThis.cancelAnimationFrame = original;
  });
  const player = new ClipPlayer(
    () => {},
    () => {},
  );
  player.setBuffer(audioBuffer(30, () => 0.2));
  player.offset = 2;
  player.lastSchedule = { offset: 2, seconds: 0.1, at: 0 };
  player.stoppedAt = 2.1;
  const clip = player.continuation(0.5);
  assert.equal(clip.offset, 2.1);
  assert.ok(Math.abs(clip.seconds - 0.4) < 1e-9);
  player.stoppedAt = 2.5;
  assert.deepEqual(player.continuation(2), { offset: 2.5, seconds: 1.5 });
  player.context = { currentTime: 3.2 };
  player.lastSchedule = { offset: 2.5, seconds: 1.5, at: 3 };
  player.source = { stop() {} };
  player.stop();
  assert.ok(Math.abs(player.position - 2.7) < 1e-9);
  assert.ok(Math.abs(player.continuation(8).seconds - 7.3) < 1e-9);
  player.setBuffer(audioBuffer(30, () => 0.2));
  assert.deepEqual(player.continuation(0.5), { offset: 0, seconds: 0.5 });
});
