import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";

const probe = createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://localhost:${port}`;
const dataDir = await mkdtemp(join(tmpdir(), "beatguessr-lobby-test-"));
process.env.DATA_DIR = dataDir;
process.env.APP_ORIGIN = base;
const { server, lobbies } = await import("../server/index.js");
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
lobbies.loadTrack = async (seed) => ({
  track: {
    ...seed,
    album: "Friends' collection",
    year: 2020,
    cover:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect width='200' height='200' fill='%23bee56c'/%3E%3C/svg%3E",
  },
  audio: { bytes: wav, type: "audio/wav" },
});
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
const browser = await chromium.launch();
const contexts = await Promise.all(
  Array.from({ length: 4 }, () =>
    browser.newContext({ viewport: { width: 1280, height: 900 } }),
  ),
);
const pages = await Promise.all(contexts.map((context) => context.newPage()));
const errors = [];
for (const page of pages) page.on("pageerror", (e) => errors.push(e.message));
try {
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
  await host.locator("#nickname").fill("Host");
  await host.locator(`#lobby-sources input[value="${playlist.id}"]`).check();
  await host.locator("#create-room").click();
  await host.locator("#room").waitFor();
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
  assert.equal(await guests[0].locator("#host-controls").isVisible(), false);
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
  assert.ok(
    (
      await Promise.all(
        pages.map((page) =>
          page.evaluate(() => beatguessrLobby.player.lastSchedule.seconds),
        ),
      )
    ).every((seconds) => seconds === 0.1),
  );
  await guests[0].locator("#room-guess").fill("Test Song");
  await guests[0].locator("#room-guess").press("Enter");
  await guests[0].waitForFunction(
    () =>
      beatguessrLobby.state.players.find(
        (p) => p.id === beatguessrLobby.state.you,
      ).solved,
  );
  assert.equal(await host.locator("#answer").isVisible(), false);
  assert.equal(await guests[0].locator("#vote-skip").isDisabled(), true);
  await host.locator("#vote-skip").click();
  await guests[1].locator("#vote-skip").click();
  await host.waitForFunction(() => beatguessrLobby.state.round.stage === 1);
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
  await host.locator("#host-reveal").click();
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
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "Four-browser lobby passed: private imports, joins, host controls, synchronized clip schedule, majority votes, individual scores, 30s reveals including unsolved rounds, host transfer, rejoin, and mobile layout.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  assert.equal(dirname(dataDir), tmpdir());
  assert.ok(basename(dataDir).startsWith("beatguessr-lobby-test-"));
  await rm(dataDir, { recursive: true, force: true });
}
