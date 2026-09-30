export function normalize(value = "") {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\b(feat\.?|ft\.?)\s.*$/i, "")
    .replace(
      /\s*[-(]\s*(remaster(ed)?|radio edit|single version|album version|deluxe|mono|stereo).*$/i,
      "",
    )
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function matchScore(seed, song) {
  const title = normalize(seed.title),
    candidate = normalize(song.title);
  const artist = normalize(seed.artist),
    other = normalize(song.artist);
  if (!title || !artist || !candidate || !other) return 0;
  if (
    /karaoke|tribute|instrumental|sped up|slowed|cover version/i.test(
      `${song.title} ${song.artist}`,
    )
  )
    return 0;
  const titleScore =
    title === candidate
      ? 1
      : candidate.includes(title) || title.includes(candidate)
        ? 0.82
        : 0;
  const artistScore =
    artist === other
      ? 1
      : other.includes(artist) || artist.includes(other)
        ? 0.85
        : 0;
  return titleScore && artistScore ? titleScore * 0.65 + artistScore * 0.35 : 0;
}
