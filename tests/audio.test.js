import test from "node:test";
import assert from "node:assert/strict";
import { ClipPlayer } from "../public/audio.js";
import { randomClipStart } from "../public/clip-start.js";

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
  player.setBuffer({ duration: 15 }, true);
  assert.ok(
    player.offset > 0,
    "Enabled random start must move into a short preview",
  );
  assert.ok(player.offset < 15);
  player.setStart(false);
  assert.equal(player.offset, 0);
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
