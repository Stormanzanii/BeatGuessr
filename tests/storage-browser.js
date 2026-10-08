import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { chromium, firefox } from "playwright";

const root = await mkdtemp(join(tmpdir(), "beatguessr-storage-test-"));
const portProbe = createServer();
await new Promise((done) => portProbe.listen(0, "127.0.0.1", done));
const port = portProbe.address().port;
await new Promise((done) => portProbe.close(done));
const base = `http://127.0.0.1:${port}`;
const engine = process.env.BEATGUESSR_TEST_BROWSER === "firefox" ? firefox : chromium;
let service, context;
let epoch = 0;
async function startServer() {
  service = spawn(process.execPath, ["server/index.js"], {
    cwd: resolve("."), windowsHide: true,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port),
      APP_ORIGIN: base, SESSION_SECRET: "storage-browser-test",
      DATA_DIR: join(root, `server-${++epoch}`) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((done, reject) => {
    service.stdout.on("data", (data) => {
      if (data.toString().includes("BeatGuessr is ready")) done();
    });
    service.once("error", reject);
    service.once("exit", (code) => reject(new Error(`Test server exited: ${code}`)));
  });
}
async function stopServer() {
  if (!service || service.exitCode !== null) return;
  const ended = new Promise((done) => service.once("exit", done));
  service.kill();
  await ended;
}
const samples = 16000 * 2;
const wav = Buffer.alloc(44 + samples * 2);
wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++)
  wav.writeInt16LE(Math.round(Math.sin(i * Math.PI * 880 / 16000) * 10000), 44 + i * 2);
const audioPath = join(root, "Test Artist - Saved local song.wav");
await writeFile(audioPath, wav);
async function routes(target) {
  await target.route("**/api/resolve", (route) => route.fulfill({ json: { track: {
    id: route.request().postDataJSON().id, title: "Cached playlist song",
    artist: "Test Artist", source: "Fixture",
  } } }));
  await target.route("**/api/audio/*", (route) => route.fulfill({ contentType: "audio/wav", body: wav }));
}
async function openBrowser() {
  context = await engine.launchPersistentContext(join(root, "profile"), { viewport: { width: 1280, height: 900 } });
  await routes(context);
  return context.pages()[0] || await context.newPage();
}
async function ready(page) {
  await page.waitForFunction(() => !beatguessr.state.loading && !!beatguessr.state.track);
}
async function importCSV(page, name = "Saved playlist") {
  await page.locator("#import-button").click();
  await page.locator("#csv-file").setInputFiles({ name: `${name}.csv`, mimeType: "text/csv",
    buffer: Buffer.from('Title,Artist,Year,Genre,Album,ISRC\n"Saved, first song",Test Artist,2000,Rock,Original Album,USAAA2000001\nSecond saved song,Test Artist,2001,Pop,Original Album,USAAA2000002') });
  await page.waitForFunction((name) => beatguessr.state.playlists.some((playlist) => playlist.name === name), name);
  await ready(page);
}
async function verifyAudio(page) {
  const restored = await page.evaluate(async () => {
    const track = beatguessr.state.local[0];
    const bytes = await track.file.arrayBuffer();
    return { title: track.title, name: track.file.name, size: track.file.size,
      digest: [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((byte) => byte.toString(16).padStart(2, "0")).join("") };
  });
  assert.equal(restored.title, "Saved local song");
  assert.equal(restored.name, basename(audioPath));
  assert.equal(restored.size, wav.length);
  assert.equal(restored.digest, createHash("sha256").update(wav).digest("hex"));
}
try {
  await startServer();
  let page = await openBrowser();
  await page.goto(base);
  await ready(page);
  await importCSV(page);
  const originalId = await page.evaluate(() => beatguessr.state.playlists[0].id);
  await page.locator("#local-files").setInputFiles(audioPath);
  await page.waitForFunction(() => beatguessr.state.local.length === 1 && !beatguessr.state.loading);
  await page.locator("#local-files").setInputFiles(audioPath);
  await ready(page);
  assert.equal(await page.evaluate(() => beatguessr.state.local.length), 1, "Adding the same file does not duplicate it");
  await page.reload();
  await ready(page);
  await verifyAudio(page);
  assert.deepEqual(await page.evaluate(() => beatguessr.state.selectedSources), [originalId, "local"]);
  console.log("PASS: playlist selection and exact audio bytes survive refresh; repeated files are deduplicated");

  await context.close(); context = null;
  await stopServer();
  await startServer();
  page = await openBrowser();
  await page.goto(base);
  await ready(page);
  await verifyAudio(page);
  const newId = await page.evaluate(() => beatguessr.state.playlists[0].id);
  assert.notEqual(newId, originalId, "The empty server creates a new playlist ID");
  assert.equal(await page.evaluate(() => beatguessr.state.playlists.length), 1);
  assert.equal(await page.evaluate(() => beatguessr.state.playlists[0].count), 2);
  assert.deepEqual(await page.evaluate(() => beatguessr.state.selectedSources), [newId, "local"]);
  assert.ok(await page.evaluate(() => beatguessr.state.pool.some((track) => track.title === "Saved, first song")));
  assert.equal(await page.evaluate(() => beatguessr.state.pool.find((track) => track.title === "Saved, first song").album), "Original Album");
  assert.equal(await page.evaluate(() => beatguessr.state.pool.find((track) => track.title === "Saved, first song").isrc), "USAAA2000001");
  console.log("PASS: files survive closing the browser; an empty server automatically recovers playlists and remaps selections");

  // Two tabs restoring at once must keep one private playlist and stable tracks.
  await stopServer(); await startServer();
  const other = await context.newPage();
  await Promise.all([page.goto(`${base}/lobby`), other.goto(`${base}/lobby`)]);
  await Promise.all([page, other].map((tab) => tab.locator('#lobby-sources input:not([value="curated"])').waitFor()));
  const library = await (await context.request.get(`${base}/api/playlists`)).json();
  assert.equal(library.playlists.length, 1);
  const restoredId = library.playlists[0].id;
  assert.equal(await page.locator(`#lobby-sources input[value="${restoredId}"]`).isChecked(), true);
  const guestBrowser = await engine.launch();
  try {
    const guest = await guestBrowser.newContext();
    const privateLibrary = await (await guest.request.get(`${base}/api/playlists`)).json();
    assert.equal(privateLibrary.playlists.length, 0, "Recovered imports stay private to their browser session");
    const response = await guest.request.post(`${base}/api/playlists/import`, {
      data: { browserRestore: true, cacheKey: library.playlists[0].cacheKey,
        name: "Guest copy", csv: "Title,Artist\nGuest song,Guest artist" },
    });
    assert.equal(response.status(), 201);
    assert.notEqual((await response.json()).playlist.id, restoredId,
      "A different visitor cannot claim a playlist by supplying its cache key");
  } finally { await guestBrowser.close(); }
  await other.close();
  console.log("PASS: lobby recovery works across simultaneous tabs without duplicate playlists or exposing private imports");

  await page.goto(base); await ready(page);
  await page.locator(".manage-sources > summary").click();
  await page.locator('[data-remove="local"]').click();
  await page.waitForFunction(() => beatguessr.state.local.length === 0 && !beatguessr.state.loading);
  await page.locator(`[data-remove="${restoredId}"]`).click();
  await page.locator(`[data-remove="${restoredId}"]`).waitFor({ state: "detached" });
  await ready(page);
  await page.reload(); await ready(page);
  assert.equal(await page.evaluate(() => beatguessr.state.local.length), 0);
  assert.equal(await page.evaluate(() => beatguessr.state.playlists.length), 0);
  console.log("PASS: removed playlists and audio stay removed after refresh");

  await context.close(); context = null;
  const browser = await engine.launch();
  try {
    for (const quota of [false, true]) {
      const unavailable = await browser.newContext();
      await routes(unavailable);
      await unavailable.addInitScript((quota) => {
        if (quota) IDBObjectStore.prototype.put = () => { throw new DOMException("Full", "QuotaExceededError"); };
        else Object.defineProperty(window, "indexedDB", { get() { throw new DOMException("Disabled", "SecurityError"); } });
      }, quota);
      const testPage = await unavailable.newPage();
      await testPage.goto(base); await ready(testPage);
      await importCSV(testPage, quota ? "Quota playlist" : "Unavailable-storage playlist");
      await testPage.locator("#local-files").setInputFiles(audioPath);
      await testPage.waitForFunction(() => beatguessr.state.local.length === 1 && !beatguessr.state.loading);
      assert.match(await testPage.locator("#library-cache-status").textContent(), quota ? /storage is full/ : /could not save/);
      await unavailable.close();
    }
  } finally { await browser.close(); }
  console.log("PASS: unavailable storage and quota errors leave files playable and explain that they were not saved");
} finally {
  if (context) await context.close();
  await stopServer();
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith("beatguessr-storage-test-"));
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
