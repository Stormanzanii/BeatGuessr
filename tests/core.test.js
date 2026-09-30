import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { catalog, filterCatalog, mergeSongs } from "../server/catalog.js";
import { matchScore } from "../server/matching.js";
import { allowedAudioURL } from "../server/providers.js";
import {
  parseCSV,
  parseSpotifyEmbed,
  spotifyPlaylistId,
} from "../server/playlists.js";

test("genre and original release year filters are inclusive and combine", () => {
  const songs = filterCatalog(catalog, { genre: "Rock", from: 1990, to: 1999 });
  assert.ok(songs.length > 10);
  assert.ok(
    songs.every((t) => t.genre === "Rock" && t.year >= 1990 && t.year <= 1999),
  );
  assert.ok(songs.some((t) => t.title === "Smells Like Teen Spirit"));
  assert.ok(!songs.some((t) => t.title === "Mr. Brightside"));
});
test("unknown playlist years are included only with unrestricted years", () => {
  const song = { title: "Unknown year", year: null, genre: "Unknown" };
  assert.equal(filterCatalog([song]).length, 1);
  assert.equal(filterCatalog([song], { from: 1990, to: 1999 }).length, 0);
});
test("multiple playlists combine without duplicate songs and preserve known metadata", () => {
  const a = [
    {
      id: "a",
      title: "Get Lucky",
      artist: "Daft Punk",
      year: null,
      genre: "Unknown",
    },
    {
      id: "b",
      title: "Dreams",
      artist: "Fleetwood Mac",
      year: 1977,
      genre: "Rock",
    },
  ];
  const b = [
    {
      id: "c",
      title: "Get Lucky",
      artist: "Daft Punk, Pharrell Williams",
      year: 2013,
      genre: "Electronic",
    },
    {
      id: "d",
      title: "Blinding Lights",
      artist: "The Weeknd",
      year: 2019,
      genre: "Pop",
    },
  ];
  const pool = mergeSongs(a, b);
  assert.equal(pool.length, 3);
  assert.equal(pool[0].year, 2013);
  assert.equal(pool[0].genre, "Electronic");
  assert.equal(
    a[0].year,
    null,
    "Merging should not mutate the stored original playlist",
  );
});
test("non-Latin song names are distinct during deduplication and matching", () => {
  const first = { id: "one", title: "봄날", artist: "방탄소년단" };
  const second = { id: "two", title: "불타오르네", artist: "방탄소년단" };
  assert.equal(mergeSongs([first, second]).length, 2);
  assert.equal(matchScore(first, second), 0);
  assert.equal(matchScore(first, first), 1);
});
test("resolver matches artist and title, rejecting unrelated songs and karaoke", () => {
  const seed = { title: "Get Lucky", artist: "Daft Punk" };
  assert.ok(
    matchScore(seed, {
      title: "Get Lucky (Radio Edit)",
      artist: "Daft Punk, Pharrell Williams & Nile Rodgers",
    }) > 0.83,
  );
  assert.equal(
    matchScore(seed, { title: "Get Lucky", artist: "Karaoke All Stars" }),
    0,
  );
  assert.equal(
    matchScore(seed, { title: "Get Lucky", artist: "Other Artist" }),
    0,
  );
  assert.equal(
    matchScore(seed, { title: "Another Song", artist: "Daft Punk" }),
    0,
  );
});
test("CSV import handles quoted commas, Spotify headers, dates and duplicate songs", () => {
  const csv =
    '\uFEFFTrack Name,Artist Name(s),Album Release Date,Genres,Track URI\n"Song, Part II","Artist A;Artist B",2013-04-19,Electronic,spotify:track:1234567890123456789012\n"Song, Part II","Artist A;Artist B",2013-04-19,Electronic,\n';
  const playlist = parseCSV(csv, "My music");
  assert.equal(playlist.tracks.length, 1);
  assert.equal(playlist.tracks[0].year, 2013);
  assert.equal(playlist.tracks[0].artist, "Artist A, Artist B");
  assert.equal(
    playlist.tracks[0].spotifyUrl,
    "https://open.spotify.com/track/1234567890123456789012",
  );
  assert.throws(() => parseCSV("Hello,World\na,b"), /Title and Artist/);
});
test("Spotify importer validates links and extracts only visible song metadata", async () => {
  const id = "37i9dQZF1DXcBWIGoYBM5M";
  assert.equal(
    spotifyPlaylistId(`https://open.spotify.com/playlist/${id}?si=test`),
    id,
  );
  assert.equal(spotifyPlaylistId(`spotify:playlist:${id}`), id);
  assert.equal(
    spotifyPlaylistId(`https://open.spotify.com/intl-en/playlist/${id}`),
    id,
  );
  assert.equal(spotifyPlaylistId(`https://evil.test/playlist/${id}`), null);
  assert.equal(spotifyPlaylistId("http://localhost:9999"), null);
  const html = `<script id="__NEXT_DATA__">${JSON.stringify({
    props: {
      pageProps: {
        state: {
          data: {
            entity: {
              title: "Test playlist",
              trackList: [
                {
                  entityType: "track",
                  uri: "spotify:track:1234567890123456789012",
                  title: "Track",
                  subtitle: "Artist",
                  audioPreview: { url: "https://p.scdn.co/preview.mp3" },
                },
                { entityType: "episode", title: "Podcast", subtitle: "Host" },
              ],
            },
          },
        },
      },
    },
  })}</script>`;
  const playlist = parseSpotifyEmbed(html, id);
  assert.equal(playlist.tracks.length, 1);
  assert.equal(playlist.tracks[0].title, "Track");
  assert.equal(playlist.tracks[0].previewUrl, undefined);
  assert.throws(() => parseSpotifyEmbed("<html></html>", id), /CSV/);
});
test("preview proxy excludes private addresses, lookalike hosts and credentials", () => {
  assert.equal(
    allowedAudioURL("https://cdnt-preview.dzcdn.net/audio.mp3"),
    true,
  );
  assert.equal(
    allowedAudioURL("https://audio-ssl.itunes.apple.com/preview.m4a"),
    true,
  );
  for (const url of [
    "http://cdnt-preview.dzcdn.net/a",
    "https://127.0.0.1/a",
    "https://evil-dzcdn.net/a",
    "https://dzcdn.net.evil.test/a",
    "https://user:pass@audio-ssl.itunes.apple.com/a",
    "https://audio-ssl.itunes.apple.com:8443/a",
  ])
    assert.equal(allowedAudioURL(url), false);
});
