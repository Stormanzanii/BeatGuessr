import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { catalog, mergeSongs } from "./catalog.js";
import { getJSON } from "./providers.js";
import { normalize } from "./matching.js";

const path = fileURLToPath(
  new URL("../data/expanded-catalog.json", import.meta.url),
);
let expanded = [];
try {
  expanded = JSON.parse(await readFile(path, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
export const libraryStatus = {
  running: false,
  stage: "idle",
  completed: 0,
  total: 0,
  added: expanded.length,
  errors: 0,
};
export const allSongs = () => mergeSongs(catalog, expanded);
async function parallel(items, callback, concurrency = 4) {
  let index = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (index < items.length) {
        const item = items[index++];
        try {
          await callback(item);
        } catch {
          libraryStatus.errors++;
        }
        libraryStatus.completed++;
      }
    }),
  );
}
export function expandLibrary() {
  if (libraryStatus.running) return;
  libraryStatus.running = true;
  libraryStatus.errors = 0;
  void (async () => {
    const artists = [
      ...new Map(
        catalog.map((t) => [t.artist, { name: t.artist, genre: t.genre }]),
      ).values(),
    ];
    const songs = [];
    libraryStatus.stage = "Finding popular songs";
    libraryStatus.completed = 0;
    libraryStatus.total = artists.length;
    await parallel(artists, async (artist) => {
      const results = await getJSON(
        `https://api.deezer.com/search/artist?${new URLSearchParams({ q: artist.name, limit: "3" })}`,
      );
      const found = results.data?.find(
        (t) => normalize(t.name) === normalize(artist.name),
      );
      if (!found) return;
      const top = await getJSON(
        `https://api.deezer.com/artist/${found.id}/top?limit=30`,
      );
      for (const t of top.data || []) {
        if (
          !t.preview ||
          /karaoke|tribute|live at|live in|instrumental|sped up|slowed/i.test(
            t.title,
          )
        )
          continue;
        songs.push({
          id: `library:${t.id}`,
          title: t.title,
          artist: t.artist.name,
          year: null,
          genre: artist.genre,
          origin: "expanded",
          deezerId: t.id,
          albumId: t.album.id,
        });
      }
    });
    const albums = [...new Set(songs.map((t) => t.albumId))],
      dates = new Map();
    libraryStatus.stage = "Adding release years";
    libraryStatus.completed = 0;
    libraryStatus.total = albums.length;
    await parallel(albums, async (id) => {
      const album = await getJSON(`https://api.deezer.com/album/${id}`);
      const date = Number(album.release_date?.slice(0, 4));
      if (date >= 1900 && date <= 2100) dates.set(id, date);
    });
    for (const song of songs) {
      song.year = dates.get(song.albumId) || null;
      delete song.albumId;
    }
    expanded = mergeSongs(expanded, songs);
    await mkdir(fileURLToPath(new URL("../data/", import.meta.url)), {
      recursive: true,
    });
    await writeFile(`${path}.tmp`, JSON.stringify(expanded));
    await rename(`${path}.tmp`, path);
    libraryStatus.added = expanded.length;
    libraryStatus.stage = "Complete";
  })()
    .catch((error) => {
      libraryStatus.stage = error.message;
    })
    .finally(() => {
      libraryStatus.running = false;
    });
}
