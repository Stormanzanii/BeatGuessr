import { matchScore } from "./matching.js";

const metadataCache = new Map();
const inflight = new Map();
export const media = new Map();

export async function getJSON(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: { "User-Agent": "BeatGuessr-local/0.1" },
  });
  if (!response.ok)
    throw new Error(
      `Music provider returned ${response.status}. Try again shortly.`,
    );
  const data = await response.json();
  if (data.error)
    throw new Error(data.error.message || "Music provider is unavailable.");
  return data;
}

const deezerSong = (t) => ({
  id: `deezer:${t.id}`,
  providerId: t.id,
  title: t.title,
  artist: t.artist?.name,
  album: t.album?.title,
  cover: t.album?.cover_big,
  previewUrl: t.preview,
  listenUrl: t.link,
  source: "Deezer",
  year: t.release_date ? Number(t.release_date.slice(0, 4)) : null,
});
const appleSong = (t) => ({
  id: `apple:${t.trackId}`,
  title: t.trackName,
  artist: t.artistName,
  album: t.collectionName,
  cover: t.artworkUrl100?.replace("100x100bb", "600x600bb"),
  previewUrl: t.previewUrl,
  listenUrl: t.trackViewUrl,
  source: "Apple Music",
  year: t.releaseDate ? Number(t.releaseDate.slice(0, 4)) : null,
  genre: t.primaryGenreName,
});

async function searchDeezer(query, requirePreview = true) {
  const data = await getJSON(
    `https://api.deezer.com/search?${new URLSearchParams({ q: query, limit: "15" })}`,
  );
  return (data.data || [])
    .map(deezerSong)
    .filter((t) => (!requirePreview || t.previewUrl) && t.title && t.artist);
}
async function searchApple(query, requirePreview = true) {
  const data = await getJSON(
    `https://itunes.apple.com/search?${new URLSearchParams({ term: query, entity: "song", limit: "15", country: "US" })}`,
  );
  return (data.results || [])
    .map(appleSong)
    .filter((t) => (!requirePreview || t.previewUrl) && t.title && t.artist);
}

const searchCache = new Map();
const searchTasks = new Map();
export async function searchSongs(query) {
  const key = query.trim().toLowerCase();
  if (key.length < 2) return [];
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.songs;
  if (searchTasks.has(key)) return searchTasks.get(key);
  const task = (async () => {
    let results = [],
      lastError,
      succeeded = false;
    for (const search of [searchDeezer, searchApple]) {
      try {
        results = await search(query, false);
        succeeded = true;
        if (results.length) break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!succeeded) throw lastError;
    const unique = new Map();
    for (const { id, title, artist } of results) {
      const identity = `${title.toLowerCase()}|${artist.toLowerCase()}`;
      if (!unique.has(identity)) unique.set(identity, { id, title, artist });
    }
    const songs = [...unique.values()].slice(0, 8);
    searchCache.set(key, { songs, at: Date.now() });
    while (searchCache.size > 150)
      searchCache.delete(searchCache.keys().next().value);
    return songs;
  })().finally(() => searchTasks.delete(key));
  searchTasks.set(key, task);
  return task;
}

export async function resolveSong(seed, failedSource) {
  const key = `${seed.id}|${failedSource || ""}`;
  const cached = metadataCache.get(key);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.song;
  if (inflight.has(key)) return inflight.get(key);
  const task = (async () => {
    let lastError;
    for (const [source, search] of [
      ["Deezer", searchDeezer],
      ["Apple Music", searchApple],
    ]) {
      if (source === failedSource) continue;
      try {
        const songs =
          source === "Deezer" && seed.deezerId
            ? [
                deezerSong(
                  await getJSON(
                    `https://api.deezer.com/track/${seed.deezerId}`,
                  ),
                ),
              ].filter((t) => t.previewUrl)
            : await search(`${seed.artist} ${seed.title}`);
        const ranked = songs
          .map((song) => ({ song, score: matchScore(seed, song) }))
          .sort((a, b) => b.score - a.score);
        if (!ranked.length || ranked[0].score < 0.83) continue;
        const match = ranked[0].song;
        const song = {
          ...match,
          title: seed.title,
          artist: seed.artist,
          seedId: seed.id,
          matchedTitle: match.title,
          matchedArtist: match.artist,
          year: seed.year ?? match.year,
          genre: seed.genre || match.genre || "Unknown",
          spotifyUrl: seed.spotifyUrl || null,
        };
        media.set(song.id, { ...song, at: Date.now() });
        metadataCache.set(key, { song, at: Date.now() });
        return song;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(
      lastError?.message ||
        "No matching preview is available for this song. Try another song or import a local audio file.",
    );
  })();
  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

export function allowedAudioURL(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      (url.hostname.endsWith(".dzcdn.net") ||
        url.hostname.endsWith(".itunes.apple.com"))
    );
  } catch {
    return false;
  }
}

export async function fetchAudio(song) {
  let url = song.previewUrl;
  // Deezer preview URLs expire; fetch fresh metadata instead of caching signed URLs forever.
  if (song.source === "Deezer" && Date.now() - song.at > 3 * 60 * 1000) {
    const fresh = await getJSON(
      `https://api.deezer.com/track/${song.providerId}`,
    );
    url = fresh.preview;
    song.previewUrl = url;
    song.at = Date.now();
  }
  for (let hop = 0; hop < 4; hop++) {
    if (!allowedAudioURL(url))
      throw new Error("Unsupported preview audio host.");
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      url = new URL(response.headers.get("location"), url).href;
      await response.body?.cancel();
      continue;
    }
    if (!response.ok)
      throw new Error(
        `Preview audio returned ${response.status}. Try another song.`,
      );
    const type = response.headers.get("content-type") || "";
    if (!/audio|octet-stream/i.test(type)) {
      await response.body?.cancel();
      throw new Error("The provider did not return audio.");
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 15 * 1024 * 1024)
        throw new Error("Preview file is too large.");
      chunks.push(chunk);
    }
    return { bytes: Buffer.concat(chunks), type };
  }
  throw new Error("Too many preview redirects.");
}
