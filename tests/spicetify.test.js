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
async function exportWith(getContents, totalLength) {
  const downloads = [],
    notifications = [];
  let callback;
  const Spicetify = {
    Platform: {
      PlaylistAPI: {
        getContents,
        getMetadata: async () => ({ name: "Complete playlist", totalLength }),
      },
    },
    ContextMenu: {
      Item: class {
        constructor(_name, handler) {
          callback = handler;
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
  await callback([`spotify:playlist:${playlistId}`]);
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
