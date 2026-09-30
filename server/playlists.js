import { parse } from "csv-parse/sync";
import { randomUUID } from "node:crypto";

export function spotifyPlaylistId(value) {
  if (/^[a-zA-Z0-9]{22}$/.test(value)) return value;
  const uri = /^spotify:playlist:([a-zA-Z0-9]{22})$/.exec(value);
  if (uri) return uri[1];
  try {
    const url = new URL(value);
    if (url.hostname !== "open.spotify.com" || url.protocol !== "https:")
      return null;
    return (
      /^\/(?:intl-[a-z]+\/)?(?:embed\/)?playlist\/([a-zA-Z0-9]{22})\/?$/.exec(
        url.pathname,
      )?.[1] || null
    );
  } catch {
    return null;
  }
}

export function parseSpotifyEmbed(html, id) {
  const match =
    /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(
      html,
    );
  if (!match)
    throw new Error(
      "Spotify did not expose this playlist. Make it public or import a CSV export.",
    );
  const entity = JSON.parse(match[1])?.props?.pageProps?.state?.data?.entity;
  if (!entity || !Array.isArray(entity.trackList))
    throw new Error(
      "Playlist data is unavailable. Import a CSV export instead.",
    );
  const tracks = entity.trackList
    .filter((t) => t.entityType === "track" && t.title && t.subtitle)
    .map((t) => ({
      id: t.uri || randomUUID(),
      title: t.title,
      artist: t.subtitle.replace(/\u00a0/g, " "),
      year: null,
      genre: "Unknown",
      origin: "spotify",
      spotifyUrl: /^spotify:track:[a-zA-Z0-9]{22}$/.test(t.uri)
        ? `https://open.spotify.com/track/${t.uri.split(":")[2]}`
        : null,
    }));
  if (!tracks.length)
    throw new Error("This playlist contains no visible songs. Try CSV import.");
  return {
    id: randomUUID(),
    name: entity.title || entity.name || "Spotify playlist",
    tracks,
    spotifyUrl: `https://open.spotify.com/playlist/${id}`,
    importedAt: new Date().toISOString(),
    note: `Imported ${tracks.length} songs visible in Spotify's public embed. Spotify may truncate large playlists. Year and genre are unknown until resolved; use CSV for complete metadata.`,
  };
}

export function parseCSV(csv, name = "Imported playlist") {
  const rows = parse(csv.replace(/^\uFEFF/, ""), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
  if (rows.length > 10000)
    throw new Error("Import up to 10,000 songs at a time.");
  const field = (row, keys) => {
    const entry = Object.entries(row).find(([key]) =>
      keys.includes(key.toLowerCase().replace(/[^a-z0-9]/g, "")),
    );
    return entry?.[1] || "";
  };
  const tracks = rows
    .map((row) => {
      const title = field(row, ["title", "trackname", "song", "name"]);
      const artist = field(row, [
        "artist",
        "artists",
        "artistnames",
        "artistname",
      ]);
      const yearValue = field(row, ["year", "releasedate", "albumreleasedate"]);
      const year = /^\d{4}(?:-|$)/.test(yearValue)
        ? Number(yearValue.slice(0, 4))
        : null;
      const uri = field(row, [
        "trackuri",
        "spotifyuri",
        "uri",
        "trackurl",
        "spotifyurl",
      ]);
      const spotifyId =
        /(?:spotify:track:|open\.spotify\.com\/track\/)([a-zA-Z0-9]{22})/.exec(
          uri,
        )?.[1];
      return {
        id: spotifyId ? `spotify:track:${spotifyId}` : randomUUID(),
        title: title.slice(0, 300),
        artist: artist.replace(/;/g, ", ").slice(0, 300),
        year: year >= 1900 && year <= 2100 ? year : null,
        genre: field(row, ["genre", "genres"]).slice(0, 100) || "Unknown",
        origin: "csv",
        spotifyUrl: spotifyId
          ? `https://open.spotify.com/track/${spotifyId}`
          : null,
      };
    })
    .filter((t) => t.title && t.artist);
  const deduped = new Map();
  for (const track of tracks) {
    const key = `${track.title.toLowerCase()}|${track.artist.toLowerCase()}`;
    const existing = deduped.get(key);
    if (existing) {
      existing.spotifyUrl ||= track.spotifyUrl;
      existing.year ??= track.year;
      if (existing.genre === "Unknown") existing.genre = track.genre;
    } else deduped.set(key, track);
  }
  const unique = [...deduped.values()];
  if (!unique.length)
    throw new Error(
      "CSV needs Title and Artist columns (Track Name and Artist Name(s) are also supported).",
    );
  return {
    id: randomUUID(),
    name: name.slice(0, 100),
    tracks: unique,
    importedAt: new Date().toISOString(),
    note: `Imported ${unique.length} songs. ${unique.filter((t) => t.year == null).length} have no year metadata.`,
  };
}
