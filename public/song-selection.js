export const SONG_ATTEMPTS = 8;

function shuffle(items, random) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled;
}
function sourceGroups(pool) {
  const groups = new Map();
  for (const song of pool) {
    const sources = new Set((song.poolSources || []).map((source) => source.id)
      .filter((id) => id != null));
    if (!sources.size) sources.add(null);
    for (const source of sources) {
      if (!groups.has(source)) groups.set(source, []);
      groups.get(source).push(song);
    }
  }
  return groups;
}
export function nextPlaylist(pool, sourceId) {
  const ids = [...sourceGroups(pool).keys()];
  return ids.length ? ids[(ids.indexOf(sourceId) + 1) % ids.length] : undefined;
}

// Choose a playlist first, then a song within that playlist.
// Back and forth tries its scheduled playlist first; failed previews can fall
// back to another source. A shared song is only attempted once.
export function songCandidates(
  pool,
  {
    played = [],
    lastPlayed = Array.isArray(played) ? played[0] : undefined,
    playlistMode = "equal",
    nextPlaylistId,
    random = Math.random,
  } = {},
) {
  const used = new Set(played);
  function candidates(tracks) {
    const alternatives = tracks.filter((song) => song.id !== lastPlayed);
    const available = alternatives.length ? alternatives : tracks;
    const unseen = available.filter((song) => !used.has(song.id));
    return shuffle(unseen.length ? unseen : available, random);
  }
  const groups = sourceGroups(pool);
  if (groups.size < 2) return candidates(pool);
  const playlists = [...groups];
  const preferred = playlistMode === "alternating"
    ? Math.max(0, playlists.findIndex(([id]) => id === nextPlaylistId))
    : Math.floor(random() * playlists.length);
  const chosen = playlists.splice(
    preferred, 1,
  )[0];
  const others = playlistMode === "alternating"
    ? [...playlists.slice(preferred), ...playlists.slice(0, preferred)] : shuffle(playlists, random);
  let ordered = [chosen, ...others]
    .map(([id, tracks]) => ({ id, tracks: candidates(tracks) }));
  const output = [],
    seen = new Set();
  if (playlistMode === "alternating") {
    const priority = ordered[0].tracks.slice(0, SONG_ATTEMPTS - 1);
    for (const song of priority) {
      seen.add(song.id);
      output.push({ ...song, selectedSourceId: ordered[0].id });
    }
    ordered = [...ordered.slice(1), { ...ordered[0], tracks: ordered[0].tracks.slice(priority.length) }];
  }
  const longest = Math.max(...ordered.map(({ tracks }) => tracks.length));
  for (let index = 0; index < longest; index++) {
    for (const { id, tracks } of ordered) {
      const song = tracks[index];
      if (song && !seen.has(song.id)) {
        seen.add(song.id);
        output.push({ ...song, selectedSourceId: id });
      }
    }
  }
  return output;
}
