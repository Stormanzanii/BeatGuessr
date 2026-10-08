import { matchingTitle, sameVersion, sameArtist } from "../public/recording.js";

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
  const title = matchingTitle(seed.title),
    candidate = matchingTitle(song.title);
  const artist = normalize(seed.artist),
    other = normalize(song.artist);
  if (!title || !artist || !candidate || !other) return 0;
  if (title !== candidate || !sameVersion(seed, song)) return 0;
  if (!sameArtist(seed.artist, song.artist)) return 0;
  if (seed.isrc && seed.isrc !== song.isrc) return 0;
  const artistScore =
    artist === other
      ? 1
      : sameArtist(seed.artist, song.artist)
        ? 0.85
        : 0;
  return artistScore ? 0.65 + artistScore * 0.35 : 0;
}
