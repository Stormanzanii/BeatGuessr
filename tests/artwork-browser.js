import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, firefox } from "playwright";

let server;
let base = process.env.BEATGUESSR_ARTWORK_BASE_URL;
if (!base) {
  ({ server } = await import("../server/index.js"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}
await mkdir("test-results", { recursive: true });
const browser = await (
  process.env.BEATGUESSR_TEST_BROWSER === "firefox" ? firefox : chromium
).launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const tracks = ["First", "Second"].map((name, index) => ({
    id: `fixture:${index}`,
    title: `${name} Artwork Fixture`,
    artist: "Test Artist",
    spotifyUrl: "https://open.spotify.com/track/1234567890123456789012",
    year: 2020,
    genre: "Pop",
    poolSources: [{ id: "curated", name: "Popular" }],
  }));
  const coverPNG = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 16;
      const context = canvas.getContext("2d");
      context.fillStyle = "#bee56c";
      context.fillRect(0, 0, 16, 16);
      return canvas.toDataURL("image/png").split(",")[1];
    }),
    "base64",
  );
  const samples = 16000 * 2;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let frame = 0; frame < samples; frame++)
    wav.writeInt16LE(
      Math.round(Math.sin((frame * Math.PI * 2 * 440) / 16000) * 10000),
      44 + frame * 2,
    );

  await page.addInitScript(() => localStorage.setItem(
    "beatguessr:settings", JSON.stringify({ sources: ["curated"] }),
  ));
  await page.route("**/api/playlists", (route) => route.fulfill({ json: {
    playlists: [], builtIns: [{ id: "curated", name: "Popular", count: tracks.length }],
  } }));
  await page.route("**/api/catalog?*", (route) => route.fulfill({ json: {
    tracks, total: tracks.length, genres: ["Pop"],
  } }));
  await page.route("**/api/resolve", (route) => {
    const seed = tracks.find((track) => track.id === route.request().postDataJSON().id);
    return route.fulfill({ json: { track: {
      ...seed, source: "Fixture", cover: `${base}/fixture-cover/${seed.id}.png`,
    } } });
  });
  await page.route("**/api/audio/*", (route) => route.fulfill({ contentType: "audio/wav", body: wav }));
  await page.route("**/fixture-cover/*", (route) => route.fulfill({ contentType: "image/png", body: coverPNG }));
  await page.goto(base);

  const failures = [];
  for (const won of [true, false]) {
    await page.waitForFunction(() => !beatguessr.state.loading && beatguessr.state.track != null);
    await page.waitForFunction(() => document.getElementById("reveal-cover").naturalWidth > 0);
    assert.equal(await page.locator("#record-art").isVisible(), false, "Artwork stays hidden before the answer");
    const source = await page.locator("#reveal-cover").getAttribute("src");
    if (won) {
      await page.locator("#guess").fill(await page.evaluate(() => beatguessr.state.track.title));
      await page.locator("#guess").press("Enter");
    } else await page.locator("#give-up").click();
    await page.waitForFunction(() => beatguessr.state.done);
    assert.equal(await page.evaluate(() => beatguessr.state.won), won);
    const spotify = page.getByRole("link", { name: "Open in Spotify", exact: true });
    assert.equal(await spotify.getAttribute("href"), "spotify:track:1234567890123456789012");
    assert.equal(await spotify.getAttribute("target"), null, "Opening Spotify does not create a browser tab");
    const outcome = won ? "correct" : "unsolved";
    await page.screenshot({ path: `test-results/artwork-${outcome}.png`, fullPage: true });
    try {
      assert.equal(await page.locator("#reveal-cover").getAttribute("src"), source,
        `${outcome}: revealing must retain the preloaded album cover`);
      assert.equal(await page.locator("#record-art").isVisible(), true,
        `${outcome}: album cover must be visible`);
      assert.ok(await page.locator("#reveal-cover").evaluate((image) =>
        image.naturalWidth > 0 && image.getBoundingClientRect().width > 40),
        `${outcome}: album cover must be loaded and displayed on the record`);
      console.log(`PASS: album cover is visible after the ${outcome} answer`);
    } catch (error) {
      failures.push(error);
    }
    if (won) await page.locator("#next-button").click();
  }
  if (failures.length) throw new AggregateError(failures, "Album artwork is missing after revealing");
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
