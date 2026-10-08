import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { createServer } from "node:net";
import { chromium, firefox } from "playwright";

const probe = createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://localhost:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "beatguessr-lobby-test-"));
process.env.DATA_DIR = dataDir;
process.env.APP_ORIGIN = base;
const { server, lobbies } = await import("../server/index.js");
let coverPNG;
const samples = 16000 * 32,
  wav = Buffer.alloc(44 + samples * 2);
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
    frame < 4000 || (frame >= 64000 && frame < 192000)
      ? 0
      : Math.round(Math.sin((frame / 16000) * Math.PI * 2 * 440) * 10000),
    44 + frame * 2,
  );
lobbies.loadTrack = async (seed) => ({
  track: {
    ...seed,
    album: "Friends' collection",
    year: 2020,
    spotifyUrl: "https://open.spotify.com/track/1234567890123456789012",
    cover:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect width='200' height='200' fill='%23bee56c'/%3E%3C/svg%3E",
  },
  audio: { bytes: wav, type: "audio/wav" },
  artwork: {
    bytes: coverPNG,
    type: "image/png",
  },
});
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
const browser = await (
  process.env.BEATGUESSR_TEST_BROWSER === "firefox" ? firefox : chromium
).launch();
const contexts = await Promise.all(
  Array.from({ length: 4 }, () =>
    browser.newContext({ viewport: { width: 1280, height: 900 } }),
  ),
);
const pages = await Promise.all(contexts.map((context) => context.newPage()));
coverPNG = Buffer.from(
  await pages[0].evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    const context = canvas.getContext("2d");
    context.fillStyle = "#bee56c";
    context.fillRect(0, 0, 2, 2);
    return canvas.toDataURL("image/png").split(",")[1];
  }),
  "base64",
);
const errors = [];
for (const page of pages) page.on("pageerror", (e) => errors.push(e.message));
try {
  const builtIns = await (
    await contexts[1].request.get(`${base}/api/playlists`)
  ).json();
  assert.equal(builtIns.builtIns[0].name, "Popular");
  const popularCatalog = await (
    await contexts[1].request.get(`${base}/api/catalog?sources=curated`)
  ).json();
  assert.ok(popularCatalog.tracks.length > 100);
  assert.equal(popularCatalog.tracks[0].poolSources[0].name, "Popular");
  const popularRoom = await contexts[1].request.post(`${base}/api/lobbies`, {
    data: { name: "Popular host", sources: ["curated"] },
  });
  assert.equal(popularRoom.status(), 201);
  const createdPopular = await popularRoom.json();
  assert.equal(
    lobbies.get(createdPopular.code).pool.length,
    popularCatalog.total,
  );
  const response = await contexts[0].request.post(
    `${base}/api/playlists/import`,
    {
      data: {
        name: "Friends' mix",
        csv: "Title,Artist,Year,Genre\nTest Song,Test Artist,2020,Pop",
      },
    },
  );
  assert.equal(response.status(), 201);
  const playlist = (await response.json()).playlist;
  assert.equal(
    (await (await contexts[1].request.get(`${base}/api/playlists`)).json())
      .playlists.length,
    0,
    "Visitors cannot read another visitor's imports",
  );
  await contexts[1].request.delete(`${base}/api/playlists/${playlist.id}`);
  assert.equal(
    (await (await contexts[0].request.get(`${base}/api/playlists`)).json())
      .playlists.length,
    1,
    "Visitors cannot delete another visitor's imports",
  );
  const forbidden = await contexts[0].request.post(`${base}/api/lobbies`, {
    headers: { Origin: "https://unrelated.example" },
    data: { name: "Intruder", sources: [playlist.id] },
  });
  assert.equal(forbidden.status(), 403);
  const [host, ...guests] = pages;
  await host.goto(`${base}/lobby`);
  assert.equal(
    await host.locator('#lobby-sources input[value="curated"]').isChecked(),
    true,
  );
  await host.locator('#lobby-sources input[value="curated"]').uncheck();
  await host.locator("#nickname").fill("Host");
  await host.locator("#room-random-start").check();
  await host.locator("#room-balance-playlists").check();
  await host.locator(`#lobby-sources input[value="${playlist.id}"]`).check();
  await host.locator("#create-room").click();
  await host.locator("#room").waitFor();
  await host.waitForFunction(() => beatguessrLobby.state.balancePlaylists === true);
  assert.equal(await host.evaluate(() => JSON.parse(localStorage.getItem("beatguessr:settings")).balancePlaylists), true);
  const code = await host.locator("#code-label").textContent();
  for (const [i, guest] of guests.entries()) {
    await guest.goto(`${base}/lobby/${code}`);
    await guest.locator("#nickname").fill(`Friend ${i + 1}`);
    await guest.locator("#join-room").click();
    await guest.locator("#room").waitFor();
  }
  await host.waitForFunction(
    () => beatguessrLobby.state.players.filter((p) => p.connected).length === 4,
  );
  await host.locator("#host-next").click();
  await host.waitForFunction(() =>
    beatguessrLobby.state.players.every((p) => p.ready),
  );
  await Promise.all(
    pages.map((page) =>
      page.waitForFunction(() =>
        beatguessrLobby.preloaded.some(
          (entry) =>
            entry.id === beatguessrLobby.state.upcoming?.id &&
            entry.audio &&
            entry.artwork,
        ),
      ),
    ),
  );
  const queuedRound = await host.evaluate(
    () => beatguessrLobby.state.upcoming.id,
  );
  let redundantLoads = 0;
  for (const page of pages)
    page.on("request", (request) => {
      if (
        request.url().endsWith(`/audio/${queuedRound}`) ||
        request.url().endsWith(`/artwork/${queuedRound}`)
      )
        redundantLoads++;
    });
  assert.equal(await guests[0].locator("#host-controls").isVisible(), false);
  for (const page of pages) {
    const others = pages.filter((other) => other !== page);
    const before = await Promise.all(
      others.map((other) =>
        other.evaluate(() => beatguessrLobby.player.lastSchedule?.at ?? null),
      ),
    );
    assert.equal(await page.locator("#play-clip").isEnabled(), true);
    await page.locator("#play-clip").click();
    await page.waitForFunction(() => !!beatguessrLobby.player.lastSchedule);
    assert.equal(
      await page.evaluate(() => beatguessrLobby.player.lastSchedule.offset),
      await page.evaluate(() => beatguessrLobby.state.round.offset),
    );
    assert.ok(
      await page.evaluate(() => {
        const player = beatguessrLobby.player,
          buffer = player.buffer;
        const start = Math.floor(
          player.lastSchedule.offset * buffer.sampleRate,
        );
        const samples = buffer
          .getChannelData(0)
          .slice(start, start + Math.floor(buffer.sampleRate * 0.1));
        return (
          Math.sqrt(
            samples.reduce((sum, value) => sum + value * value, 0) /
              samples.length,
          ) > 0.02
        );
      }),
      "Every player's 0.1-second clip contains audible waveform energy",
    );
    const generation = await page.evaluate(
      () => beatguessrLobby.player.generation,
    );
    const marker = `Personal replay ${generation} ${pages.indexOf(page)}`;
    lobbies.get(code).message = marker;
    lobbies.broadcast(lobbies.get(code));
    await page.waitForFunction(
      (message) => beatguessrLobby.state.message === message,
      marker,
    );
    assert.equal(
      await page.evaluate(() => beatguessrLobby.player.generation),
      generation,
      "State updates do not interrupt personal replays",
    );
    assert.deepEqual(
      await Promise.all(
        others.map((other) =>
          other.evaluate(() => beatguessrLobby.player.lastSchedule?.at ?? null),
        ),
      ),
      before,
      "A personal replay never starts audio for others",
    );
    await page.waitForFunction(() => !beatguessrLobby.player.playing);
  }
  await host.locator("#host-play").click();
  await Promise.all(
    pages.map((page) =>
      page.waitForFunction(() => beatguessrLobby.player.playing),
    ),
  );
  const starts = await Promise.all(
    pages.map((page) =>
      page.evaluate(() => beatguessrLobby.state.round.playback.startsAt),
    ),
  );
  assert.ok(starts.every((value) => value === starts[0]));
  const offsets = await Promise.all(
    pages.map((page) =>
      page.evaluate(() => beatguessrLobby.player.lastSchedule.offset),
    ),
  );
  assert.ok(
    offsets[0] > 0 && offsets.every((value) => value === offsets[0]),
    "Everyone uses the host's shared random start",
  );
  assert.ok(
    (
      await Promise.all(
        pages.map((page) =>
          page.evaluate(() => beatguessrLobby.player.lastSchedule.seconds),
        ),
      )
    ).every((seconds) => seconds === 0.1),
  );
  for (const guest of [guests[0], guests[1]])
    await guest.route("**/api/lobbies/*/suggestions?*", (route) =>
      route.fulfill({
        json: {
          tracks: [
            { id: "wrong", title: "Wrong Song", artist: "Wrong Artist" },
            { id: "right", title: "Test Song", artist: "Test Artist" },
          ],
        },
      }),
    );
  await guests[0].locator("#room-guess").fill("Wrong Song");
  await guests[0].locator("#room-suggestions [role=option]").first().click();
  await guests[0].waitForFunction(
    () => beatguessrLobby.state.wrongGuesses.length === 1,
  );
  await guests[0].locator("#room-guess").fill("Wrong Song");
  await guests[0].locator("#room-suggestions .guessed-wrong").waitFor();
  assert.equal(
    await guests[0]
      .locator("#room-suggestions [role=option]")
      .first()
      .isDisabled(),
    true,
  );
  await guests[0]
    .locator("#room-suggestions [role=option]")
    .first()
    .evaluate((button) => button.click());
  assert.equal(
    await guests[0].evaluate(() => beatguessrLobby.state.wrongGuesses.length),
    1,
  );
  await guests[0].locator("#room-guess").press("ArrowDown");
  assert.equal(
    await guests[0]
      .locator("#room-guess")
      .getAttribute("aria-activedescendant"),
    "room-option-1",
  );
  await guests[0].locator("#room-guess").press("Escape");
  await guests[1].locator("#room-guess").fill("Wrong Song");
  await guests[1].locator("#room-suggestions [role=option]").first().waitFor();
  assert.equal(
    await guests[1]
      .locator("#room-suggestions [role=option]")
      .first()
      .isEnabled(),
    true,
    "Another player's wrong guesses stay private",
  );
  await guests[1].locator("#room-guess").press("Escape");
  await guests[0].locator("#room-guess").fill("Test Song");
  await guests[0].locator("#room-guess").press("Enter");
  await guests[0].waitForFunction(
    () =>
      beatguessrLobby.state.players.find(
        (p) => p.id === beatguessrLobby.state.you,
      ).solved,
  );
  assert.equal(await host.locator("#answer").isVisible(), false);
  assert.equal(await guests[0].locator("#vote-skip").isEnabled(), true);
  await host.locator("#vote-skip").click();
  await guests[1].locator("#vote-skip").click();
  await guests[2].locator("#vote-skip").click();
  await host.waitForFunction(() => beatguessrLobby.state.round.votes === 3);
  assert.equal(
    await host.evaluate(() => beatguessrLobby.state.round.skipAt),
    null,
  );
  await guests[0].locator("#vote-skip").click();
  await Promise.all(
    pages.map((page) => page.locator("#skip-countdown").waitFor()),
  );
  const deadlines = await Promise.all(
    pages.map((page) =>
      page.evaluate(() => beatguessrLobby.state.round.skipAt),
    ),
  );
  assert.ok(deadlines.every((deadline) => deadline === deadlines[0]));
  assert.equal(await host.evaluate(() => beatguessrLobby.state.round.stage), 0);
  assert.match(
    await host.locator("#skip-countdown").textContent(),
    /Longer clip in 30s/,
  );
  await mkdir("test-results", { recursive: true });
  await host.screenshot({
    path: "test-results/lobby-countdown.png",
    fullPage: true,
  });
  await guests[1].locator("#play-clip").click();
  await host.waitForFunction(
    () => beatguessrLobby.state.round.stage === 1,
    null,
    { timeout: 40000 },
  );
  assert.equal(await host.locator("#skip-countdown").isVisible(), false);
  await Promise.all(
    pages.map((page) =>
      page.waitForFunction(
        () =>
          Math.abs(beatguessrLobby.player.lastSchedule.seconds - 0.4) < 1e-6,
      ),
    ),
  );
  for (const page of pages)
    assert.ok(
      await page.evaluate(
        () =>
          Math.abs(
            beatguessrLobby.player.lastSchedule.offset -
              beatguessrLobby.state.round.offset -
              0.1,
          ) < 1e-6,
      ),
      "A longer clip continues from the previous ending",
    );
  await guests[1].locator("#play-clip").click();
  await guests[1].locator("#play-clip").click();
  await guests[1].waitForFunction(
    () => beatguessrLobby.player.lastSchedule.seconds === 0.5,
  );
  assert.equal(
    await guests[1].evaluate(() => beatguessrLobby.player.lastSchedule.offset),
    await guests[1].evaluate(() => beatguessrLobby.state.round.offset),
    "An explicit replay restarts at the round's starting point",
  );
  for (const page of [host, guests[1], guests[2]]) {
    await page.locator("#room-guess").fill("Test Song");
    await page.locator("#room-guess").press("Enter");
  }
  await Promise.all(
    pages.map((page) =>
      page.waitForFunction(
        () =>
          beatguessrLobby.state.round.phase === "revealed" &&
          beatguessrLobby.player.lastSchedule?.seconds === 30,
      ),
    ),
  );
  const scores = await host.evaluate(() =>
    beatguessrLobby.state.players.map((p) => p.score).sort((a, b) => a - b),
  );
  assert.deepEqual(scores, [80, 80, 80, 100]);
  await host.locator("#host-stop").click();
  await host.waitForFunction(() => !beatguessrLobby.player.playing);
  await Promise.all(
    pages.map((page) =>
      page.waitForFunction(() => !beatguessrLobby.player.playing),
    ),
  );
  await guests[1].locator("#play-clip").click();
  await guests[1].waitForFunction(() => beatguessrLobby.player.playing);
  await host.locator("#host-stop").click();
  await guests[1].waitForFunction(() => !beatguessrLobby.player.playing);
  await mkdir("test-results", { recursive: true });
  await host.screenshot({
    path: "test-results/lobby-desktop.png",
    fullPage: true,
  });
  await guests[2].setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await guests[2].evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await guests[2].screenshot({
    path: "test-results/lobby-mobile.png",
    fullPage: true,
  });
  await host.locator("#host-next").click();
  await host.waitForFunction(
    () =>
      beatguessrLobby.state.round.phase === "guessing" &&
      beatguessrLobby.state.players.every((p) => p.ready),
  );
  assert.equal(await host.locator("#answer").isVisible(), false);
  assert.equal(
    await host.evaluate(() => beatguessrLobby.state.round.id),
    queuedRound,
  );
  assert.equal(
    redundantLoads,
    0,
    "Advancing to a preloaded song does not refetch audio or artwork",
  );
  await host.locator("#host-reveal").click();
  await host.locator('#answer-links a[href="spotify:track:1234567890123456789012"]').waitFor();
  assert.equal(await host.locator('#answer-links a[href="spotify:track:1234567890123456789012"]').getAttribute("target"), null);
  await Promise.all(
    pages.map((page) =>
      page.waitForFunction(
        () =>
          beatguessrLobby.state.round.phase === "revealed" &&
          beatguessrLobby.player.lastSchedule?.seconds === 30,
      ),
    ),
  );
  assert.ok(
    (await host.evaluate(() => beatguessrLobby.state.players)).every(
      (p) => !p.solved,
    ),
  );
  await host.locator("#leave-room").click();
  await guests[0].waitForFunction(
    () => beatguessrLobby.state.hostId === beatguessrLobby.state.you,
  );
  await guests[1].reload();
  await guests[1].locator("#join-room").click();
  await guests[1].waitForFunction(
    () =>
      beatguessrLobby.state?.players.find(
        (p) => p.id === beatguessrLobby.state.you,
      )?.score === 80,
  );
  const soloImport = await contexts[0].request.post(
    `${base}/api/playlists/import`,
    {
      data: {
        name: "Preload test",
        csv: "Title,Artist\nFirst Fixture,Test Artist\nSecond Fixture,Test Artist",
      },
    },
  );
  const soloId = (await soloImport.json()).playlist.id;
  const soloPool = (
    await (
      await contexts[0].request.get(`${base}/api/catalog?sources=${soloId}`)
    ).json()
  ).tracks;
  const audioReads = new Map(),
    coverReads = new Map();
  await host.route("**/api/resolve", async (route) => {
    const seed = soloPool.find(
      (song) => song.id === route.request().postDataJSON().id,
    );
    await route.fulfill({
      json: {
        track: {
          ...seed,
          source: "Fixture",
          cover: `${base}/fixture-cover/${seed.id}.png`,
        },
      },
    });
  });
  await host.route("**/api/audio/*", async (route) => {
    const id = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/").at(-1),
    );
    audioReads.set(id, (audioReads.get(id) || 0) + 1);
    await route.fulfill({ contentType: "audio/wav", body: wav });
  });
  await host.route("**/fixture-cover/*", async (route) => {
    const id = new URL(route.request().url()).pathname
      .split("/")
      .at(-1)
      .replace(/\.png$/, "");
    coverReads.set(id, (coverReads.get(id) || 0) + 1);
    await route.fulfill({
      contentType: "image/png",
      body: coverPNG,
    });
  });
  await host.addInitScript((id) => {
    if (sessionStorage.getItem("preload-test-initialized")) return;
    sessionStorage.setItem("preload-test-initialized", "true");
    localStorage.setItem(
      "beatguessr:settings",
      JSON.stringify({ sources: [id], confettiMultiplier: 1 }),
    );
  }, soloId);
  await host.goto(base);
  await host.waitForFunction(
    () =>
      !beatguessr.state.loading &&
      beatguessr.preloaded &&
      document.getElementById("reveal-cover").naturalWidth > 0,
  );
  const firstId = await host.evaluate(() => beatguessr.state.track.id);
  assert.equal(await host.locator("#balance-playlists").isChecked(), false);
  const nextId = soloPool.find((song) => song.id !== firstId).id;
  assert.equal(
    audioReads.get(nextId),
    1,
    "Solo downloads the next song before it is needed",
  );
  const firstArtReads = coverReads.get(firstId);
  await host.locator("#play-button").click();
  await host.waitForFunction(
    () =>
      beatguessr.player.lastSchedule?.seconds === 0.1 &&
      !beatguessr.player.playing,
  );
  const soloStart = await host.evaluate(() => beatguessr.player.offset);
  await host.locator("#skip-button").click();
  await host.waitForFunction(
    () => Math.abs(beatguessr.player.lastSchedule.seconds - 0.4) < 1e-6,
  );
  assert.ok(
    Math.abs(
      (await host.evaluate(() => beatguessr.player.lastSchedule.offset)) -
        soloStart -
        0.1,
    ) < 1e-6,
    "Solo advancing plays only the next portion",
  );
  await host.waitForFunction(() => !beatguessr.player.playing);
  await host.locator("#play-button").click();
  await host.waitForFunction(
    () => beatguessr.player.lastSchedule.seconds === 0.5,
  );
  assert.equal(
    await host.evaluate(() => beatguessr.player.lastSchedule.offset),
    soloStart,
    "Solo replay returns to the round's starting point",
  );
  await host.locator("#give-up").click();
  assert.equal(await host.locator("#record-art").isVisible(), true);
  assert.ok(
    await host
      .locator("#reveal-cover")
      .evaluate(
        (image) => image.naturalWidth > 0 && !!image.getAttribute("src"),
      ),
    "The reveal retains the preloaded cover instead of clearing it",
  );
  assert.equal(
    coverReads.get(firstId),
    firstArtReads,
    "Revealing uses artwork already loaded into the record",
  );
  await host.locator("#next-button").click();
  await host.waitForFunction(
    (id) => !beatguessr.state.loading && beatguessr.state.track.id === id,
    nextId,
  );
  assert.equal(
    audioReads.get(nextId),
    1,
    "Solo next song reuses the decoded preload without fetching again",
  );
  await host.locator(".settings > summary").click();
  await host.locator("#random-start").check();
  assert.ok(await host.evaluate(() => beatguessr.player.offset > 0));
  await host.reload();
  await host.waitForFunction(
    () => !beatguessr.state.loading && beatguessr.state.track,
  );
  assert.equal(
    await host.locator("#random-start").isChecked(),
    true,
    "Random-start setting survives refresh",
  );
  assert.ok(
    await host.evaluate(() => beatguessr.player.offset > 0),
    "Refresh applies random start to the loaded audio",
  );
  await host.locator("#play-button").click();
  await host.waitForFunction(
    () => beatguessr.player.lastSchedule?.offset === beatguessr.player.offset,
  );
  assert.equal(
    await host.evaluate(() => beatguessr.player.lastSchedule.offset),
    await host.evaluate(() => beatguessr.player.offset),
  );
  await host.waitForFunction(() => beatguessr.preloaded);
  await host.locator("#reroll").click();
  await host.waitForFunction(
    () => !beatguessr.state.loading && beatguessr.state.track,
  );
  assert.ok(
    await host.evaluate(() => beatguessr.player.offset > 0),
    "Preloaded next songs use the current random-start setting",
  );
  await host.locator(".settings > summary").click();
  await host.locator("#random-start").uncheck();
  await host.reload();
  await host.waitForFunction(
    () => !beatguessr.state.loading && beatguessr.state.track,
  );
  assert.equal(await host.locator("#random-start").isChecked(), false);
  assert.ok(
    await host.evaluate(
      () =>
        beatguessr.player.offset >= 0.24 && beatguessr.player.offset <= 0.26,
    ),
    "Random off still skips the fixture's leading silence",
  );
  const current = await host.evaluate(() => beatguessr.state.track);
  const incorrect = soloPool.find((song) => song.id !== current.id);
  await host.route("**/api/search?*", (route) =>
    route.fulfill({ json: { tracks: [incorrect, current] } }),
  );
  await host.locator("#guess").fill("Test Artist");
  const wrongOption = host
    .locator("#suggestions [role=option]")
    .filter({ hasText: incorrect.title });
  await wrongOption.click();
  const guessStage = await host.evaluate(() => beatguessr.state.stage);
  await host.locator("#guess").fill("Test Artist");
  await host.locator("#suggestions .guessed-wrong").waitFor();
  assert.equal(await wrongOption.isDisabled(), true);
  await wrongOption.evaluate((button) => button.click());
  assert.equal(
    await host.evaluate(() => beatguessr.state.stage),
    guessStage,
    "Clicking a disabled guess cannot consume another attempt",
  );
  await host.locator("#guess").press("ArrowDown");
  assert.equal(
    await host
      .locator('#suggestions [aria-selected="true"] strong')
      .textContent(),
    current.title,
  );
  await host.screenshot({
    path: "test-results/incorrect-suggestion.png",
    fullPage: true,
  });
  await host.locator("#guess").press("Escape");
  await host.locator("#reroll").click();
  await host.waitForFunction(() => !beatguessr.state.loading);
  await host.locator("#guess").fill("Test Artist");
  await wrongOption.waitFor();
  assert.equal(
    await wrongOption.isEnabled(),
    true,
    "A new round clears incorrect suggestions",
  );
  const balanceIds = [];
  for (const [name, count] of [["Small balanced mix", 1], ["Large balanced mix", 9]]) {
    const response = await contexts[0].request.post(`${base}/api/playlists/import`, {
      data: {
        name,
        csv: "Title,Artist\n" + Array.from({ length: count }, (_, index) =>
          `${name} ${index},Test Artist`).join("\n"),
      },
    });
    balanceIds.push((await response.json()).playlist.id);
  }
  const balancedPool = (await (await contexts[0].request.get(
    `${base}/api/catalog?sources=${balanceIds.join(",")}`,
  )).json()).tracks;
  await host.unroute("**/api/resolve");
  await host.route("**/api/resolve", async (route) => {
    const seed = balancedPool.find((song) => song.id === route.request().postDataJSON().id);
    await route.fulfill({ json: { track: {
      ...seed, source: "Fixture", cover: `${base}/fixture-cover/${seed.id}.png`,
    } } });
  });
  await host.addInitScript(() => { Math.random = () => 0; });
  await host.evaluate((sources) => {
    const settings = JSON.parse(localStorage.getItem("beatguessr:settings"));
    localStorage.setItem("beatguessr:settings", JSON.stringify({
      ...settings, sources, balancePlaylists: false,
    }));
  }, balanceIds);
  await host.reload();
  await host.waitForFunction(() => !beatguessr.state.loading && beatguessr.preloaded);
  assert.equal(await host.evaluate(() => beatguessr.state.track.poolSources[0].id), balanceIds[1]);
  await host.locator("#balance-playlists").check();
  await host.waitForFunction(() => beatguessr.preloaded);
  await host.locator("#reroll").click();
  await host.waitForFunction(() => !beatguessr.state.loading);
  assert.equal(await host.evaluate(() => beatguessr.state.track.poolSources[0].id), balanceIds[0],
    "Enabling balance replaces the queued song and selects the small playlist first for this random roll");
  assert.equal(await host.evaluate(() => JSON.parse(localStorage.getItem("beatguessr:settings")).balancePlaylists), true);
  await host.screenshot({ path: "test-results/balanced-playlists.png", fullPage: true });
  await host.reload();
  await host.waitForFunction(() => !beatguessr.state.loading);
  assert.equal(await host.locator("#balance-playlists").isChecked(), true,
    "Equal playlist chances persist across refreshes");
  await host.locator("#balance-playlists").uncheck();
  assert.equal(await host.evaluate(() => beatguessr.state.balancePlaylists), false);
  await host.locator("#reroll").click();
  await host.waitForFunction(() => !beatguessr.state.loading);
  assert.equal(await host.evaluate(() => beatguessr.state.track.poolSources[0].id), balanceIds[1],
    "Disabling balance restores selection from the combined song pool");
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "Four-browser lobby passed: personal and shared playback, unanimous votes with 30s countdown, scores, 30s reveals, reconnects, wrong guesses, and audio/artwork preloading.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  assert.equal(dirname(dataDir), tmpdir());
  assert.ok(basename(dataDir).startsWith("beatguessr-lobby-test-"));
  await rm(dataDir, { recursive: true, force: true });
}
