import test from "node:test";
import assert from "node:assert/strict";
import { resolveSong } from "../server/providers.js";
import { matchScore } from "../server/matching.js";

const seed = { title: "Test Song", artist: "Test Artist" };
const deezer = (id, title, extras = {}) => ({
  id, title, artist: { name: "Test Artist" },
  preview: "https://cdns-preview.dzcdn.net/fixture.mp3", ...extras,
});
test("a studio playlist track skips a live Deezer result and uses the studio fallback", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    if (new URL(url).hostname === "api.deezer.com")
      return Response.json({ data: [deezer(90101, "Test Song (Live at Wembley)")] });
    return Response.json({ results: [{ trackId: 90102, trackName: "Test Song",
      artistName: "Test Artist", previewUrl: "https://audio-ssl.itunes.apple.com/fixture.m4a" }] });
  });
  const song = await resolveSong({ ...seed, id: "live-version-regression" });
  assert.equal(song.source, "Apple Music", "Live audio must not substitute for a studio track");
  assert.equal(song.matchedTitle, "Test Song");
});
test("provider version fields and live-album metadata cannot bypass version checks", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => new URL(url).hostname === "api.deezer.com"
    ? Response.json({ data: [
      deezer(90103, "Test Song", { title_version: "(Live at Wembley)" }),
      deezer(90104, "Test Song", { album: { title: "Live at Wembley" } }),
    ] }) : Response.json({ results: [] }));
  await assert.rejects(resolveSong({ ...seed, id: "hidden-live-version-regression" }), /No matching preview/);
});
test("alternate recordings do not match an unqualified studio title", () => {
  for (const suffix of ["Live", "Acoustic", "Radio Edit", "Single Version", "Remastered 2011",
    "Club Remix", "Demo", "Instrumental", "Sped Up", "Slowed + Reverb", "Re-Recorded", "Extended Mix"])
    assert.equal(matchScore(seed, { ...seed, title: `Test Song (${suffix})` }), 0, suffix);
  assert.equal(matchScore({ title: "Song", artist: "Queen" }, { title: "Song", artist: "Queens of the Stone Age" }), 0);
  assert.equal(matchScore({ title: "Test", artist: "Test Artist" }, seed), 0, "A different title sharing a word is not the same song");
});
test("explicitly requested versions match only their recording details", () => {
  const requested = { ...seed, title: "Test Song (Live at Wembley)" };
  assert.ok(matchScore(requested, { ...seed, title: "Test Song - Live at Wembley" }) > 0.83);
  assert.equal(matchScore(requested, seed), 0);
  assert.equal(matchScore(requested, { ...seed, title: "Test Song (Live at Berlin)" }), 0);
  assert.equal(matchScore({ ...seed, title: "Test Song (Club Remix)" },
    { ...seed, title: "Test Song (Radio Remix)" }), 0);
  assert.ok(matchScore({ ...seed, title: "Live and Let Die" }, { ...seed, title: "Live and Let Die" }) > 0.83);
});

test("album editions and unrecognized provider versions are treated conservatively", () => {
  assert.equal(matchScore(seed, { ...seed, album: "Original Album (Remastered 2011)" }), 0);
  assert.equal(matchScore(seed, { ...seed, version: "(New Recording)" }), 0);
  assert.ok(matchScore(seed, { ...seed, album: "Live Through This" }) > 0.83);
});

test("a provided ISRC resolves the exact recording instead of searching title variants", async (t) => {
  const isrc = "USAAA2000001";
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(String(url));
    assert.equal(new URL(url).pathname, `/track/isrc:${isrc}`);
    return Response.json(deezer(90105, "Test Song", { isrc }));
  });
  const song = await resolveSong({ ...seed, id: "isrc-recording-regression", isrc });
  assert.equal(song.id, "deezer:90105");
  assert.equal(requests.length, 1);
  assert.equal(matchScore({ ...seed, isrc }, { ...seed, isrc: "USAAA2000002" }), 0);
  assert.equal(matchScore({ ...seed, isrc }, seed), 0, "An unverified recording does not substitute for a known ISRC");
});

test("known featured artists cannot be replaced by different collaborators", () => {
  assert.equal(matchScore({ ...seed, title: "Test Song (feat. Original Guest)" },
    { ...seed, title: "Test Song (feat. Other Guest)" }), 0);
  assert.equal(matchScore({ ...seed, artist: "Test Artist, Original Guest" },
    { ...seed, title: "Test Song (feat. Other Guest)" }), 0);
  assert.equal(matchScore({ ...seed, artist: "Test Artist feat. Original Guest" },
    { ...seed, artist: "Test Artist feat. Other Guest" }), 0);
});
