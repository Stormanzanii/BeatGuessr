function shuffle(items, random) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled;
}

// Choose a playlist first when balancing, then a song within that playlist.
// Retry candidates alternate between playlists so an unavailable preview can
// fall back to another source. A shared song is only attempted once.
export function songCandidates(
  pool,
  {
    played = [],
    lastPlayed = Array.isArray(played) ? played[0] : undefined,
    balancePlaylists = false,
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
  if (!balancePlaylists) return candidates(pool);

  const groups = new Map();
  const unassigned = Symbol("unassigned source");
  for (const song of pool) {
    const sources = new Set(
      (song.poolSources || [])
        .map((source) => source.id)
        .filter((id) => id != null),
    );
    if (!sources.size) sources.add(unassigned);
    for (const source of sources) {
      if (!groups.has(source)) groups.set(source, []);
      groups.get(source).push(song);
    }
  }
  if (groups.size < 2) return candidates(pool);
  const playlists = [...groups.values()];
  const chosen = playlists.splice(
    Math.floor(random() * playlists.length), 1,
  )[0];
  const ordered = [chosen, ...shuffle(playlists, random)].map(candidates);
  const output = [],
    seen = new Set();
  const longest = Math.max(...ordered.map((tracks) => tracks.length));
  for (let index = 0; index < longest; index++) {
    for (const tracks of ordered) {
      const song = tracks[index];
      if (song && !seen.has(song.id)) {
        seen.add(song.id);
        output.push(song);
      }
    }
  }
  return output;
}
