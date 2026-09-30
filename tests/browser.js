import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

await mkdir("test-results", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto("http://localhost:3000");
  await page.waitForFunction(() => !window.beatguessr.state.loading, null, {
    timeout: 120000,
  });
  const initial = await page.evaluate(() => ({
    title: beatguessr.state.track?.title,
    source: beatguessr.state.track?.source,
    duration: beatguessr.player.buffer?.duration,
    message: document.querySelector("#message").textContent,
  }));
  assert.ok(initial.title, initial.message);
  assert.ok(
    initial.duration >= 15,
    "Provider preview must contain enough audio for the 15-second stage",
  );
  console.log("Live provider:", JSON.stringify(initial));
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  const panels = await page
    .locator(".workspace > .panel")
    .evaluateAll((elements) =>
      elements.map((el) => ({
        top: el.getBoundingClientRect().top,
        bottom: el.getBoundingClientRect().bottom,
      })),
    );
  assert.equal(panels.length, 3);
  assert.ok(
    panels.every(
      (p) =>
        Math.abs(p.top - panels[0].top) < 1 &&
        Math.abs(p.bottom - panels[0].bottom) < 1,
    ),
    "All three panels must have aligned top and bottom edges",
  );
  const guessBounds = await page.locator("#guess").boundingBox();
  const skipBounds = await page.locator("#skip-button").boundingBox();
  assert.ok(
    skipBounds.x > guessBounds.x + guessBounds.width,
    "Skip button must be to the right of the guess textbox",
  );

  // Real decoded provider audio, real Web Audio scheduling, each requested length.
  for (const [index, seconds] of [0.1, 0.5, 2, 8, 15].entries()) {
    await page.locator(`[data-stage="${index}"]`).click();
    await page.locator("#play-button").click();
    await page.waitForFunction(() => window.beatguessr.player.playing);
    const schedule = await page.evaluate(() => beatguessr.player.lastSchedule);
    assert.equal(schedule.seconds, seconds);
    assert.ok(Math.abs(schedule.endsAt - schedule.at - seconds) < 1e-8);
    if (seconds === 0.1) {
      await page.waitForFunction(() => !window.beatguessr.player.playing);
      assert.equal(
        await page.locator("#audio-progress").evaluate((el) => el.style.width),
        "100%",
      );
    } else await page.evaluate(() => beatguessr.player.stop());
  }
  console.log(
    "All five audio durations scheduled correctly; 0.1-second playback ended.",
  );
  await page.locator('[data-stage="0"]').click();
  await page.locator("#guess").fill("This is a deliberately incorrect guess");
  await page.locator("#guess").press("Enter");
  assert.equal(await page.evaluate(() => beatguessr.state.stage), 1);
  await page.locator("#guess").fill(initial.title);
  await page.locator("#guess").press("Enter");
  assert.equal(await page.evaluate(() => beatguessr.state.stats.solved), 1);
  assert.equal(await page.locator("#reveal").isVisible(), true);
  assert.equal(
    await page.locator("#reveal-source").textContent(),
    "Source: Built-in songs",
  );
  await page.waitForFunction(() => beatguessr.player.playing);
  const reward = await page.evaluate(() => beatguessr.player.lastSchedule);
  assert.equal(reward.seconds, Math.min(30, initial.duration));
  assert.equal(reward.offset, 0);
  assert.equal(await page.locator("#play-text").textContent(), "Stop snippet");
  await page.locator("#play-button").click();
  assert.equal(await page.evaluate(() => beatguessr.player.playing), false);
  await page.locator("#play-button").click();
  await page.waitForFunction(() => beatguessr.player.playing);
  assert.equal(
    await page.evaluate(() => beatguessr.player.lastSchedule.seconds),
    reward.seconds,
  );
  assert.equal(
    await page.locator("canvas.confetti").getAttribute("data-particles"),
    "9000",
  );
  await page.waitForTimeout(650);
  await page.screenshot({ path: "test-results/reveal.png", fullPage: true });
  console.log(
    "Wrong guess advances a stage; correct title reveals the song and updates stats.",
  );

  await page.locator("#next-button").click();
  assert.equal(
    await page.evaluate(() => beatguessr.player.playing),
    false,
    "Next song stops the winning snippet",
  );
  await page.waitForFunction(
    () => !beatguessr.state.loading && beatguessr.state.track != null,
    null,
    { timeout: 120000 },
  );
  await page.locator("#skip-button").click();
  assert.equal(await page.evaluate(() => beatguessr.state.stage), 1);
  console.log("Skip button beside textbox advances the clip.");
  await page.locator("#give-up").click();
  assert.equal(
    await page.evaluate(() => beatguessr.player.playing),
    false,
    "Revealing an unsolved song must not autoplay the reward",
  );

  await page.locator(".filter-settings > summary").click();
  await page.locator("#genre").selectOption("Rock");
  await page.locator('[data-decade="1990"]').click();
  await page.locator("#apply-filters").click();
  await page.waitForFunction(
    () => !beatguessr.state.loading && beatguessr.state.track != null,
    null,
    { timeout: 120000 },
  );
  const filtered = await page.evaluate(() =>
    beatguessr.state.pool.map(({ genre, year }) => ({ genre, year })),
  );
  assert.ok(
    filtered.length > 0 &&
      filtered.every(
        (t) => t.genre === "Rock" && t.year >= 1990 && t.year <= 1999,
      ),
  );
  console.log("Combined genre and decade filters:", filtered.length, "songs.");

  await page.locator("#import-button").click();
  await page.locator("#csv-file").setInputFiles({
    name: "Browser test.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Title,Artist,Year,Genre\nGet Lucky,Daft Punk,2013,Electronic\nDreams,Fleetwood Mac,1977,Rock",
    ),
  });
  await page.waitForFunction(
    () =>
      !document.querySelector("#import-dialog").open &&
      !beatguessr.state.loading &&
      beatguessr.state.track != null,
    null,
    { timeout: 120000 },
  );
  assert.equal(await page.evaluate(() => beatguessr.state.pool.length), 2);
  const firstPlaylistId = await page.evaluate(
    () => beatguessr.state.selectedSources[0],
  );
  await page
    .locator("#guess")
    .fill(await page.evaluate(() => beatguessr.state.track.title));
  await page.locator("#guess").press("Enter");
  assert.equal(
    await page.locator("#reveal-source").textContent(),
    "Source: Browser test",
  );
  await page.locator("#import-button").click();
  await page.locator("#csv-file").setInputFiles({
    name: "Browser test second.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Title,Artist,Year,Genre\nGet Lucky,Daft Punk,2013,Electronic\nBlinding Lights,The Weeknd,2019,Pop",
    ),
  });
  await page.waitForFunction(
    () =>
      !document.querySelector("#import-dialog").open &&
      !beatguessr.state.loading &&
      beatguessr.state.selectedSources.length === 2,
    null,
    { timeout: 120000 },
  );
  assert.equal(
    await page.evaluate(() => beatguessr.state.pool.length),
    3,
    "Two overlapping playlists should combine to three unique songs",
  );
  assert.deepEqual(
    await page.evaluate(() =>
      beatguessr.state.pool
        .find((t) => t.title === "Get Lucky")
        .poolSources.map((s) => s.name),
    ),
    ["Browser test", "Browser test second"],
  );
  await page.evaluate(() => {
    beatguessr.state.played = beatguessr.state.pool
      .filter((t) => t.title !== "Get Lucky")
      .map((t) => t.id);
  });
  await page.locator("#reroll").click();
  await page.waitForFunction(
    () =>
      !beatguessr.state.loading &&
      beatguessr.state.track?.title === "Get Lucky",
    null,
    { timeout: 120000 },
  );
  await page.locator("#guess").fill("Get Lucky");
  await page.locator("#guess").press("Enter");
  assert.equal(
    await page.locator("#reveal-source").textContent(),
    "Sources: Browser test · Browser test second",
  );
  await page.locator("#source-button").click();
  assert.equal(await page.locator("#source-dropdown input:checked").count(), 2);
  await page.screenshot({
    path: "test-results/multiple-sources.png",
    fullPage: true,
  });
  await page.locator(`[data-source="${firstPlaylistId}"]`).uncheck();
  await page.locator("#apply-filters").click();
  await page.waitForFunction(() => !beatguessr.state.loading, null, {
    timeout: 120000,
  });
  assert.equal(
    await page.evaluate(() => beatguessr.state.pool.length),
    2,
    "Unchecking one playlist removes its exclusive song",
  );
  await page.locator(".manage-sources > summary").click();
  for (const id of await page.evaluate(() =>
    beatguessr.state.playlists
      .filter((p) => p.name.startsWith("Browser test"))
      .map((p) => p.id),
  )) {
    await page.locator(`[data-remove="${id}"]`).click();
    await page.waitForFunction(() => !beatguessr.state.loading, null, {
      timeout: 120000,
    });
  }
  console.log(
    "CSV imports, two-source pool deduplication, checkboxes, and removal passed.",
  );

  const sampleRate = 8000,
    sampleCount = sampleRate * 16;
  const wav = Buffer.alloc(44 + sampleCount * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(sampleCount * 2, 40);
  for (let i = 0; i < sampleCount; i++)
    wav.writeInt16LE(
      Math.round(Math.sin((i * 2 * Math.PI * 440) / sampleRate) * 3000),
      44 + i * 2,
    );
  await page.locator("#local-files").setInputFiles({
    name: "Fixture Artist - Fixture Song.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  await page.waitForFunction(
    () =>
      !beatguessr.state.loading &&
      beatguessr.state.track?.source === "Local file",
    null,
    { timeout: 30000 },
  );
  assert.equal(
    await page.evaluate(() => beatguessr.state.track.title),
    "Fixture Song",
  );
  assert.equal(await page.evaluate(() => beatguessr.player.offset), 0);
  assert.equal(
    await page.evaluate(() => Math.round(beatguessr.player.buffer.duration)),
    16,
  );
  await page.locator("#play-button").click();
  await page.waitForFunction(() => !beatguessr.player.playing);
  console.log("Local WAV import decodes and plays from the actual intro.");
  await page.evaluate(() => {
    beatguessr.player.offset = 1;
  });
  await page.locator("#guess").fill("Fixture Song");
  await page.locator("#guess").press("Enter");
  await page.waitForFunction(() => beatguessr.player.playing);
  assert.equal(
    await page.evaluate(() => beatguessr.player.lastSchedule.seconds),
    16,
    "Short audio uses the full available snippet",
  );
  assert.equal(
    await page.locator("#reveal-source").textContent(),
    "Source: Local audio",
  );
  assert.equal(
    await page.evaluate(() => beatguessr.player.lastSchedule.offset),
    0,
  );
  await page.locator("#next-button").click();
  await page.waitForFunction(
    () => !beatguessr.state.loading && beatguessr.state.track != null,
  );
  await page.evaluate(() => {
    const { player } = beatguessr;
    player.setBuffer(
      player.context.createBuffer(
        1,
        player.context.sampleRate * 45,
        player.context.sampleRate,
      ),
    );
    player.offset = 35;
  });
  await page.locator("#guess").fill("Fixture Song");
  await page.locator("#guess").press("Enter");
  await page.waitForFunction(() => beatguessr.player.playing);
  assert.equal(
    await page.evaluate(() => beatguessr.player.lastSchedule.seconds),
    30,
  );
  assert.equal(
    await page.evaluate(() => beatguessr.player.lastSchedule.offset),
    15,
    "A late random start shifts back to leave 30 seconds",
  );
  assert.equal(
    await page.evaluate(() => beatguessr.player.offset),
    35,
    "Reward playback preserves the round offset",
  );
  await page.locator("#next-button").click();
  await page.waitForFunction(
    () => !beatguessr.state.loading && beatguessr.state.track != null,
  );
  console.log(
    "Correct guesses autoplay up to 30 seconds; replay, short files, random starts, and next-song cancellation passed.",
  );

  await page.route("**/api/search?*", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    if (query === "delay")
      await new Promise((resolve) => setTimeout(resolve, 450));
    if (query === "unavailable")
      return route.fulfill({ status: 503, json: { error: "Unavailable" } });
    return route.fulfill({
      json: {
        tracks:
          query === "fixture"
            ? [
                {
                  id: "external:fixture",
                  title: "Fixture Song",
                  artist: "Fixture Artist",
                },
              ]
            : [
                {
                  id: "external:outside",
                  title: "Outside Song",
                  artist: "Other Artist",
                },
              ],
      },
    });
  });
  await page.locator(".settings > summary").click();
  await page.locator("#confetti-amount").fill("1");
  await page.locator("#guess").fill("outside");
  await page.locator("#suggestions [role=option]").waitFor();
  assert.equal(
    await page.locator("#suggestions strong").textContent(),
    "Outside Song",
  );
  assert.equal(
    await page.evaluate(() =>
      beatguessr.state.pool.some((t) => t.title === "Outside Song"),
    ),
    false,
  );
  await page.locator("#guess").press("ArrowDown");
  await page.locator("#guess").press("Enter");
  assert.equal(await page.evaluate(() => beatguessr.state.stage), 1);
  await page.locator("#guess").fill("delay");
  await page.waitForRequest(
    (request) => new URL(request.url()).searchParams.get("q") === "delay",
  );
  await page.locator("#guess").press("Escape");
  await page.waitForTimeout(600);
  assert.equal(
    await page.locator("#suggestions").isVisible(),
    false,
    "Escape cancels delayed suggestions",
  );
  await page.locator("#guess").fill("unavailable");
  await page
    .locator(".suggestion-status")
    .filter({ hasText: "Search is unavailable" })
    .waitFor();
  assert.equal(await page.locator("#guess").isEnabled(), true);
  await page.locator("#guess").fill("Fixture Song");
  assert.equal(
    await page.locator("#suggestions strong").first().textContent(),
    "Fixture Song",
    "An exact playlist title is immediately selectable",
  );
  await page.locator("#guess").fill("fixture");
  await page.locator("#suggestions [role=option]").waitFor();
  await page.locator("#guess").press("ArrowDown");
  await page.locator("#guess").press("Enter");
  assert.equal(
    await page.evaluate(() => beatguessr.state.won),
    true,
    "A correct external result works across provider IDs",
  );
  assert.equal(
    await page.locator("canvas.confetti").getAttribute("data-duration"),
    "2",
  );
  await page
    .locator("canvas.confetti")
    .waitFor({ state: "detached", timeout: 4000 });
  await page.reload();
  assert.equal(await page.locator("#confetti-amount").inputValue(), "1");
  console.log(
    "Wider search, keyboard guesses, stale-response cancellation, provider errors, and two-second 1x confetti passed.",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "Mobile layout must not overflow horizontally",
  );
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  await page.locator("#help-button").click();
  assert.equal(await page.locator("#help-dialog").isVisible(), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#help-dialog").isVisible(), false);
  assert.deepEqual(errors, []);
  console.log("Mobile layout, help dialog, and browser error checks passed.");
} finally {
  await browser.close();
}
