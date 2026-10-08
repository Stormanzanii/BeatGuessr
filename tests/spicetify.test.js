import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { parseCSV } from "../server/playlists.js";

const script = await readFile(
  new URL("../public/spicetify/beatguessr-export.js", import.meta.url),
  "utf8",
);
const playlistId = "0000000000000000000001";
const tracks = Array.from({ length: 350 }, (_, i) => ({
  uid: `row-${i}`,
  uri: `spotify:track:${String(i).padStart(22, "0")}`,
  name: `Song ${i}`,
  artists: [{ name: "Test Artist" }],
}));
async function exportWith(getContents, totalLength, liked = false) {
  const downloads = [],
    notifications = [];
  let callback, available;
  const Spicetify = {
    Platform: {
      PlaylistAPI: {
        getContents,
        getMetadata: async () => ({ name: "Complete playlist", totalLength }),
      },
      LibraryAPI: { getTracks: (options) => getContents(null, options) },
    },
    ContextMenu: {
      Item: class {
        constructor(_name, handler, predicate) {
          callback = handler;
          available = predicate;
        }
        register() {}
      },
    },
    showNotification: (message, error) =>
      notifications.push({ message, error }),
  };
  runInNewContext(script, {
    window: { Spicetify },
    Spicetify,
    Blob,
    URL: {
      createObjectURL: (blob) => {
        downloads.push(blob);
        return "blob:test";
      },
      revokeObjectURL() {},
    },
    document: {
      body: { append() {} },
      createElement: () => ({ click() {}, remove() {} }),
    },
    setTimeout() {},
  });
  const uri = liked ? "spotify:collection:tracks" : `spotify:playlist:${playlistId}`;
  assert.equal(available([uri]), true);
  assert.equal(available(["spotify:user:test:collection"]), true);
  await callback([uri]);
  return { downloads, notifications };
}

test("Spicetify exports all pages when Spotify returns fewer rows than requested", async () => {
  const offsets = [];
  const { downloads } = await exportWith(async (_uri, { offset }) => {
    offsets.push(offset);
    return {
      items: tracks.slice(offset, offset + 50),
      totalLength: tracks.length,
    };
  }, tracks.length);
  assert.deepEqual(offsets, [0, 50, 100, 150, 200, 250, 300]);
  assert.equal(downloads.length, 1);
  const playlist = parseCSV(await downloads[0].text());
  assert.equal(playlist.tracks.length, 350);
  assert.equal(
    playlist.spotifyUrl,
    `https://open.spotify.com/playlist/${playlistId}`,
  );
  assert.equal(playlist.possiblyTruncated, false);
});

test("Spicetify follows short pages to the end when the total is unknown", async () => {
  const offsets = [];
  const { downloads } = await exportWith(async (_uri, { offset }) => {
    offsets.push(offset);
    return { items: tracks.slice(offset, offset + 100) };
  });
  assert.deepEqual(offsets, [0, 100, 200, 300, 350]);
  assert.equal(parseCSV(await downloads[0].text()).tracks.length, 350);
});

test("Spicetify refuses a repeated page instead of downloading an incomplete playlist", async () => {
  const { downloads, notifications } = await exportWith(
    async () => ({ items: tracks.slice(0, 100) }),
    350,
  );
  assert.equal(downloads.length, 0);
  assert.ok(
    notifications.some((n) => n.error && /repeated a page/.test(n.message)),
  );
});

test("Spicetify reports premature empty pages instead of calling the export complete", async () => {
  const { downloads, notifications } = await exportWith(
    async (_uri, { offset }) => ({ items: offset ? [] : tracks.slice(0, 100) }),
    350,
  );
  assert.equal(downloads.length, 0);
  assert.ok(notifications.some((n) => n.error && /100 of 350/.test(n.message)));
});

test("Spicetify waits for modern React menu APIs before registering the exporter", () => {
  let registered = 0;
  const callbacks = [];
  const Spicetify = {
    Platform: { PlaylistAPI: {} },
    ContextMenuV2: {},
    ContextMenu: { Item: class {
      constructor() {
        assert.ok(Spicetify.ReactJSX?.jsx, "ReactJSX is not ready yet");
      }
      register() { registered++; }
    } },
  };
  assert.doesNotThrow(() => runInNewContext(script, {
    window: { Spicetify }, Spicetify, setTimeout: (callback) => callbacks.push(callback),
  }));
  assert.equal(registered, 0);
  Spicetify.React = {};
  Spicetify.ReactJSX = { jsx() {} };
  Spicetify.ReactComponent = { MenuItem() {} };
  callbacks.shift()();
  assert.equal(registered, 1);
});

test("Liked Songs exports every page even when Spotify reports a zero total", async () => {
  const offsets = [];
  const { downloads } = await exportWith(async (_uri, { offset }) => {
    offsets.push(offset);
    return { items: tracks.slice(offset, offset + 100), totalLength: 0 };
  }, undefined, true);
  assert.deepEqual(offsets, [0, 100, 200, 300, 350]);
  const playlist = parseCSV(await downloads[0].text(), "Liked Songs");
  assert.equal(playlist.tracks.length, 350);
  assert.equal(playlist.spotifyUrl, undefined, "Liked Songs does not invent a public playlist URL");
});

test("a playlist with nonempty pages and zero totals is read to the end", async () => {
  const { downloads } = await exportWith(async (_uri, { offset }) => ({
    items: tracks.slice(offset, offset + 100), totalLength: 0,
  }), 0);
  assert.equal(parseCSV(await downloads[0].text()).tracks.length, 350);
});
