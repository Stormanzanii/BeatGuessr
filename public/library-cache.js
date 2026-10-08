let database;
function openLibrary() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open("beatguessr-library", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("playlists", { keyPath: "key" });
      request.result.createObjectStore("audio", { keyPath: "id" });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        database = null;
      };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other BeatGuessr tabs and refresh to access saved files."));
  }).catch((error) => {
    database = null;
    throw error;
  });
  return database;
}
async function readRecords(name) {
  const db = await openLibrary();
  return new Promise((resolve, reject) => {
    const request = db.transaction(name).objectStore(name).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function writeRecords(name, records = [], remove = [], clear = false) {
  const db = await openLibrary();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(name, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error("Could not save files in this browser."));
    try {
      const store = transaction.objectStore(name);
      if (clear) store.clear();
      for (const key of remove) store.delete(key);
      for (const record of records) store.put(record);
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}
export function cacheErrorMessage(error) {
  return error.name === "QuotaExceededError"
    ? "Browser storage is full. Your new files are available for this session but could not be saved."
    : "This browser could not save or restore your files. Keep the originals for later visits.";
}
const cell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
function playlistCSV(playlist, tracks) {
  return [
    ["Title", "Artist", "Year", "Genre", "Track URI", "Playlist URL", "Album", "ISRC"],
    ...tracks.map((track) => [
      track.title, track.artist, track.year,
      track.genre === "Unknown" ? "" : track.genre,
      track.spotifyUrl || (/^spotify:track:/.test(track.id) ? track.id : ""),
      playlist.spotifyUrl || "",
      track.album || "", track.isrc || "",
    ]),
  ].map((row) => row.map(cell).join(",")).join("\r\n");
}
async function savePlaylist(playlist, request, previous) {
  const data = await request(`/api/catalog?${new URLSearchParams({
    sources: playlist.id, from: "1900", to: "2100",
  })}`);
  const record = {
    key: previous?.key || playlist.id,
    id: playlist.id,
    ids: [...new Set([...(previous?.ids || []), previous?.id, playlist.id].filter(Boolean))],
    name: playlist.name,
    count: playlist.count,
    importedAt: playlist.importedAt,
    spotifyUrl: playlist.spotifyUrl,
    possiblyTruncated: playlist.possiblyTruncated === true,
    csv: playlistCSV(playlist, data.tracks),
  };
  await writeRecords("playlists", [record]);
  return record;
}
export async function rememberPlaylist(playlist, request) {
  const records = await readRecords("playlists");
  const previous = records.find((record) => record.id === playlist.id ||
    (playlist.spotifyUrl && record.spotifyUrl === playlist.spotifyUrl));
  return savePlaylist(playlist, request, previous);
}
export async function forgetPlaylist(id) {
  const records = await readRecords("playlists");
  await writeRecords("playlists", [], records.filter((record) =>
    record.id === id || record.ids?.includes(id)).map((record) => record.key));
}

// Replay saved metadata through the normal importer when the server loses its
// library. Stable cache keys make recovery idempotent across multiple tabs.
export async function restoredPlaylists(request) {
  const data = await request("/api/playlists");
  const sourceMap = new Map();
  const warnings = [];
  let saved;
  try { saved = await readRecords("playlists"); }
  catch (error) { return { ...data, sourceMap, warning: cacheErrorMessage(error) }; }
  for (const record of saved) {
    let playlist = data.playlists.find((item) => item.id === record.id ||
      item.cacheKey === record.key || (record.spotifyUrl && item.spotifyUrl === record.spotifyUrl));
    try {
      if (!playlist) {
        ({ playlist } = await request("/api/playlists/import", {
          method: "POST",
          body: JSON.stringify({
            name: record.name, csv: record.csv, cacheKey: record.key,
            browserRestore: true, possiblyTruncated: record.possiblyTruncated,
          }),
        }));
        data.playlists.push(playlist);
      }
      for (const id of [record.key, record.id, ...(record.ids || [])])
        sourceMap.set(id, playlist.id);
      if (playlist.id !== record.id || playlist.importedAt !== record.importedAt || playlist.count !== record.count)
        await savePlaylist(playlist, request, record);
    } catch (error) {
      warnings.push(playlist ? cacheErrorMessage(error) : `Could not restore “${record.name}”. Refresh to retry.`);
    }
  }
  for (const playlist of data.playlists) {
    if (saved.some((record) => record.id === playlist.id || record.key === playlist.cacheKey ||
      (playlist.spotifyUrl && record.spotifyUrl === playlist.spotifyUrl))) continue;
    try { await savePlaylist(playlist, request); }
    catch (error) { warnings.push(cacheErrorMessage(error)); }
  }
  return { ...data, sourceMap, warning: [...new Set(warnings)].join(" ") };
}
export const savedAudio = () => readRecords("audio");
export const rememberAudio = (tracks) => writeRecords("audio", tracks);
export const clearAudio = () => writeRecords("audio", [], [], true);
