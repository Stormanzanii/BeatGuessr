const searchKey = (value) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

export function mergeSuggestions(pool, external, query) {
  const key = searchKey(query);
  if (!key) return [];
  const matches = pool
    .map((song) => {
      const title = searchKey(song.title),
        artist = searchKey(song.artist);
      const rank =
        title === key || title + artist === key || artist + title === key
          ? 0
          : title.startsWith(key)
            ? 1
            : title.includes(key)
              ? 2
              : (title + artist).includes(key) || (artist + title).includes(key)
                ? 3
                : -1;
      return { song, rank };
    })
    .filter((match) => match.rank >= 0)
    .sort((a, b) => a.rank - b.rank);
  const exact = matches
    .filter((match) => match.rank === 0)
    .map((match) => match.song);
  const partial = matches
    .filter((match) => match.rank > 0)
    .map((match) => match.song);
  // Keep exact playlist answers selectable while retaining wider-catalog decoys.
  const candidates = [
    ...exact,
    ...external.slice(0, 4),
    ...partial.slice(0, 3),
    ...external.slice(4),
    ...partial.slice(3),
  ];
  const unique = new Map();
  for (const song of candidates) {
    const identity = `${searchKey(song.title)}|${searchKey(song.artist)}`;
    if (!unique.has(identity)) unique.set(identity, song);
  }
  return [...unique.values()].slice(0, 8);
}
