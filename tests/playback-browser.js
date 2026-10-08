import assert from "node:assert/strict";
import { chromium, firefox } from "playwright";

let server;
let base = process.env.BEATGUESSR_PLAYBACK_BASE_URL;
if (!base) {
  ({ server } = await import("../server/index.js"));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${server.address().port}`;
}
const browser = await (process.env.BEATGUESSR_TEST_BROWSER === "firefox" ? firefox : chromium).launch();
try {
  const page = await browser.newPage();
  await page.route("**/api/playlists", (route) => route.fulfill({ json: { playlists: [], builtIns: [] } }));
  await page.route("**/api/catalog?*", (route) => route.fulfill({ json: { tracks: [], genres: [] } }));
  const samples = 16000 * 32;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
  for (let sample = 0; sample < samples; sample++)
    wav.writeInt16LE(Math.round(Math.sin(sample * Math.PI * 880 / 16000) * 10000), 44 + sample * 2);
  await page.goto(base);
  await page.locator("#local-files").setInputFiles({
    name: "Test Artist - Continuous fixture.wav", mimeType: "audio/wav", buffer: wav,
  });
  await page.waitForFunction(() => !!beatguessr.state.track && !beatguessr.state.loading);
  await page.locator(".settings > summary").click();
  await page.locator("#random-start").check();
  await page.locator("[data-stage='1']").click();
  await page.locator("#play-button").click();
  await page.waitForFunction(() => !!beatguessr.player.lastSchedule && !beatguessr.player.playing);
  const trackId = await page.evaluate(() => beatguessr.state.track.id);
  const initialOffset = await page.evaluate(() => beatguessr.player.offset);
  const originalBuffer = await page.evaluateHandle(() => beatguessr.player.buffer);
  assert.ok(initialOffset > 0, "The loop also exercises a nonzero random starting point");
  let previous = 0.5;
  for (const seconds of [2, 8, 15]) {
    await page.locator("#skip-button").click();
    await page.waitForFunction(() => beatguessr.player.playing);
    const clip = await page.evaluate(() => ({
      ...beatguessr.player.lastSchedule,
      trackId: beatguessr.state.track.id, start: beatguessr.player.offset,
    }));
    assert.equal(clip.trackId, trackId, "Advancing keeps the same song");
    assert.equal(clip.start, initialOffset, "Advancing keeps the same random starting point");
    assert.equal(await page.evaluate((buffer) => buffer === beatguessr.player.buffer, originalBuffer), true,
      "Advancing uses the same decoded recording");
    assert.ok(Math.abs(clip.offset - initialOffset - previous) < 1e-6,
      `${previous}s → ${seconds}s must start where the preceding clip ended`);
    assert.ok(Math.abs(clip.seconds - (seconds - previous)) < 1e-6,
      `${previous}s → ${seconds}s plays only the remaining audio`);
    await page.waitForFunction(() => !beatguessr.player.playing);
    console.log(`PASS: ${previous}s → ${seconds}s continues the same recording at the preceding clip's end`);
    previous = seconds;
  }
  await originalBuffer.dispose();
  await page.locator("#play-button").click();
  await page.waitForFunction(() => beatguessr.player.playing);
  assert.equal(await page.evaluate(() => beatguessr.player.lastSchedule.offset), initialOffset,
    "An explicit replay starts at the fixed beginning of the round");
  await page.locator("#play-button").click();
} finally {
  await browser.close();
  if (server) await new Promise((done) => server.close(done));
}
