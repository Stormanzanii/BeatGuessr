import test from "node:test";
import assert from "node:assert/strict";
import { songCandidates } from "../public/song-selection.js";

const songs = (source, count) => Array.from({ length: count }, (_, index) => ({
  id: `${source}-${index}`,
  poolSources: [{ id: source, name: source }],
}));
function seededRandom() {
  let seed = 123456;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

test("balanced playlists each receive half the picks despite different sizes", () => {
  const pool = [...songs("small", 2), ...songs("large", 98)];
  for (const balancePlaylists of [false, true]) {
    const random = seededRandom();
    let small = 0;
    for (let round = 0; round < 4000; round++) {
      const first = songCandidates(pool, { balancePlaylists, random })[0];
      if (first.poolSources[0].id === "small") small++;
    }
    if (balancePlaylists) assert.ok(small > 1800 && small < 2200, `${small}/4000 small-playlist picks`);
    else assert.ok(small < 150, "Disabled mode keeps uniform song selection");
  }
});

test("a smaller exhausted playlist retains its share while another has unseen songs", () => {
  const pool = [...songs("small", 2), ...songs("large", 98)];
  const first = songCandidates(pool, {
    balancePlaylists: true,
    played: ["small-1", "small-0"],
    random: () => 0,
  })[0];
  assert.equal(first.id, "small-0", "Choose the small playlist and avoid its last song");
});

test("balanced selection supports three playlists and ignores filtered-out sources", () => {
  const pool = [...songs("a", 1), ...songs("b", 2), ...songs("c", 5)];
  for (const [roll, source] of [[0, "a"], [0.4, "b"], [0.8, "c"]]) {
    assert.equal(songCandidates(pool, { balancePlaylists: true, random: () => roll })[0].poolSources[0].id, source);
  }
  assert.equal(songCandidates(pool.filter((song) => song.poolSources[0].id === "b"), {
    balancePlaylists: true, random: () => 0,
  }).length, 2);
  assert.deepEqual(songCandidates([], { balancePlaylists: true }), []);
});

test("shared tracks remain unique and retries include other playlists early", () => {
  const shared = { id: "shared", poolSources: [{ id: "a" }, { id: "b" }, { id: "a" }] };
  const pool = [shared, ...songs("a", 10), ...songs("b", 1)];
  const candidates = songCandidates(pool, { balancePlaylists: true, random: () => 0.1 });
  assert.equal(new Set(candidates.map((song) => song.id)).size, candidates.length);
  assert.ok(candidates.slice(0, 3).some((song) => song.poolSources.some((source) => source.id === "b")));
  assert.equal(pool.length, 12, "Selection leaves the source pool intact");
});

test("both modes prefer unseen songs and avoid an immediate repeat when possible", () => {
  const pool = songs("one", 3);
  for (const balancePlaylists of [false, true]) {
    assert.equal(songCandidates(pool, { balancePlaylists, played: ["one-0", "one-1"] })[0].id, "one-2");
    const exhausted = songCandidates(pool, { balancePlaylists, played: ["one-0", "one-1", "one-2"] });
    assert.ok(exhausted.every((song) => song.id !== "one-0"));
    assert.equal(songCandidates([pool[0]], { balancePlaylists, played: ["one-0"] })[0], pool[0]);
  }
});
