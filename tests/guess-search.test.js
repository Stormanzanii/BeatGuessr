import test from "node:test";
import assert from "node:assert/strict";
import { mergeSuggestions } from "../public/guess-search.js";

const song = { id: "playlist-song", title: "Été", artist: "Playlist Artist" };
const external = Array.from({ length: 8 }, (_, i) => ({
  id: `external-${i}`,
  title: `Other song ${i}`,
  artist: "Another Artist",
}));

test("exact playlist titles rank first even when the provider omits the song", () => {
  const results = mergeSuggestions([song], external, "ete");
  assert.equal(results[0].id, song.id);
  assert.ok(results.some((result) => result.id.startsWith("external-")));
  assert.equal(results.length, 8);
});

test("playlist matches remain selectable when external search fails", () => {
  assert.equal(mergeSuggestions([song], [], "Été")[0].id, song.id);
  assert.equal(
    mergeSuggestions([song], [], "Playlist Artist Été")[0].id,
    song.id,
  );
});

test("matching playlist and provider results appear once and preserve the playlist ID", () => {
  const results = mergeSuggestions(
    [song],
    [{ ...song, id: "provider-id" }],
    "Été",
  );
  assert.deepEqual(results, [song]);
});

test("partial playlist matches mix with wider results without showing unrelated pool entries", () => {
  const results = mergeSuggestions(
    [{ id: "other", title: "Unrelated", artist: "Someone" }, song],
    external,
    "et",
  );
  assert.ok(results.some((result) => result.id === song.id));
  assert.ok(results.some((result) => result.id.startsWith("external-")));
  assert.ok(!results.some((result) => result.id === "other"));
  assert.deepEqual(mergeSuggestions([song], external, "?!"), []);
});
