# SongSpot public client analysis

Inspected on 30 September 2026. This covers the public website, downloaded JavaScript, ordinary game API responses, and observed browser requests. It does not recover private server source, the complete database, hosting credentials, or the process used to acquire its hosted audio.

SongSpot separates a song catalog from playback. Its catalog uses Spotify identifiers and advertised stream-count tiers. A round resolves to either a provider preview or an audio file on `audio.songspot.net`. The browser decodes that file and controls the length locally. It does not request a separate file for each of the five clip lengths.

## How a player uses it

A player chooses a genre, era, and difficulty, then presses Play and enters a song title. Search suggestions provide selectable guesses. Wrong guesses and skips reveal progressively longer audio: 0.1, 0.5, 2, 8, and 15 seconds. Individual stages can be disabled. Finishing reveals the answer and listening links; reroll starts another round. There is no daily-round limit. The FAQ describes friend challenge links and a history of 2,000 recently served songs. [SongSpot FAQ](https://songspot.net/faq)

The main interface also exposes playback from the start versus a provider preview, easy search, volume, wide/tight layouts, simple/arcade styling, and real/simple spotlight options. The global menu links to other Allspot games and offers feedback. These controls are present in the downloaded client bundle; no feedback was submitted during inspection. [Inspected client bundle](https://songspot.net/_next/static/chunks/07twa09qend_u.js)

## Song selection and catalog

The client requests a round with difficulty, playback mode, era, and genre. The ordinary browser request observed was:

```http
POST /api/round?difficulty=easy&songStart=preview&era=any&genre=any

{"exclude":[]}
```

Subsequent rounds send up to 2,000 history identifiers in `exclude`. The client stores those identifiers in `songspot:served-tracks:v1`, including rounds that are skipped or lost. This is cross-visit browser history, not evidence of a server-side user account.

The response includes `track`, `historyId`, selected category, and a title/artist `seed`. One sampled round returned Ariana Grande's One Last Time as `deezer:83844536` for playback but `spotify:7xoUc6faLbCqZO6fQEYprd` as its history identity. That demonstrates that catalog identity and audio provider identity differ. Local capture: `probe-1.json`.

The bundle displays the following thresholds. These are the site's advertised tiers; the underlying stream-count dataset and update schedule are not public in the inspected material.

| Difficulty | Advertised streams         |
| ---------- | -------------------------- |
| Easy       | 1.2 billion or more        |
| Medium     | 800 million to 1.2 billion |
| Hard       | 550 to 800 million         |
| Expert     | 375 to 550 million         |
| Impossible | 250 to 375 million         |

Era choices are Any, Classic (before 2000), 2000s, 2010s, and 2020s. Genres are All, Pop, Hip-Hop, Rock/Alternative, R&B, Country/Folk, and K-Pop. The client forces K-Pop to Any era. It includes per-difficulty/era completion counts and stores won-track history under `songspot:won-by-category:v1`. Those constants do not prove the current live database size. [Client evidence](https://songspot.net/_next/static/chunks/07twa09qend_u.js)

The server's random weighting, retry selection, ingestion jobs, and exact catalog curation cannot be derived from the response alone. Spotify IDs and stream labels support a Spotify-oriented metadata catalog; they do not establish whether the operator scraped Spotify, licensed another dataset, or compiled it manually.

## Where the audio comes from

### Provider preview mode

The sampled preview round returned a signed MP3 URL under `cdnt-preview.dzcdn.net`, album art under `cdn-images.dzcdn.net`, and a Deezer listening link. The browser trace showed a direct request to the Deezer CDN. The client also contains a proxy route, expiry detection for Deezer signed URLs, and fallback requests when a provider fails. Local capture: `probe-1.json`., Local capture: `browser-observations.json`.

The bundle handles Deezer and iTunes/Apple Music sources. If loading one fails, it can call `/api/track` with `failedSource` to obtain an alternative. This was verified in client code; every fallback branch was not forced against the production server.

### From the start mode

A sampled request with `songStart=start` returned Christina Perri's A Thousand Years and this audio location:

```text
https://audio.songspot.net/songs/03H03k1F6t3VqCSPRBtuHk.m4a
```

The JSON labels the track `source: "spotify"`, `fullTrack: true`, and `clipSeconds: 15`, with `fullUrl: null`. This proves the client is directed to a SongSpot-hosted asset keyed by a Spotify track ID. **It does not prove that Spotify serves those bytes, or that the file contains the full recording.** The source label is application metadata. The acquisition method, licensing arrangements, storage vendor, and processing pipeline remain unknown. Local capture: `probe-2.json`.

BeatGuessr does not hotlink these assets or reuse SongSpot's production backend.

## Audio engine

The client uses `AudioContext`, fetches audio, and calls `decodeAudioData`. It creates an `AudioBufferSourceNode` and gain nodes for each playback. A scheduled gain envelope fades in and out over a few milliseconds to avoid clicks. The audio clock defines the reveal window, while animation frames update the visual progress indicator. A short post-envelope delay precedes stopping the source.

For hosted intros the bundle scans short windows near the beginning to account for leading silence. It caches decoded/prefetched sources, warms the next round, resumes interrupted audio contexts, and attempts mobile audio-session handling. Settings such as volume are persisted independently of each round. [Client audio implementation](https://songspot.net/_next/static/chunks/07twa09qend_u.js)

This architecture explains why a tenth-second clip can be consistent despite network delay: downloading and decoding happen before the player schedules the slice. A timer that simply pauses a streaming HTML audio element after 100 milliseconds would not provide the same timing control.

## Search and answer checks

Normal search first uses Apple's iTunes Search API with a song entity, then falls back to the site's `/api/search` route. Catalog search adds `catalog=1`. Query results are cached and deduplicated. In the sampled catalog search, Daft Punk results carried catalog identities and Spotify links but no audio preview URLs. Local capture: `probe-3.json`.

The client normalizes case, accents, punctuation, bracketed/version text, and artist strings. Answer checks use an exact ID when available, otherwise a normalized title plus artist match. Answers and seed metadata are returned to the browser before a round is solved, so developer tools can expose the answer. This is a casual client-side game rather than an anti-cheat design.

## Public endpoints observed in the client

| Endpoint                       | Role and evidence                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `/api/round`                   | Select a round, apply filters/exclusions, or resolve a challenge. Observed live.           |
| `/api/track`                   | Resolve title/artist to a playback source or alternate provider. In client code.           |
| `/api/audio`                   | Audio proxy with optional Deezer identifier to support refreshed previews. In client code. |
| `/api/search`                  | General or catalog search. Catalog search sampled live.                                    |
| `/api/artwork`                 | Lazy cover/album/listening-link lookup. In client code.                                    |
| `/api/runtime-control`         | Revision and default playback mode. Observed live.                                         |
| `api.allspot.net/api/presence` | Presence reporting. In client code; not manually submitted.                                |
| `api.allspot.net/api/feedback` | Shared feedback submission and status. In client code; not submitted.                      |

`/api/runtime-control` is polled every 15 seconds while visible. Its revision is stored in sessionStorage; a newer revision can trigger a page reload. The observed default was preview mode. Local capture: `probe-0.json`.

## Challenges and frontend operation

Challenge URLs use `/c/<token>`. The client constructs a URL-safe Base64 token from difficulty, title, artist, result, and era, separated by a unit-separator character. The friendly link presentation hides the song name, but the token is encoding rather than encryption. The server accepts the token through the round endpoint.

The page is a Next.js/React application delivered in Turbopack chunks. The bundle includes motion/animation components, canvas effects, a confetti implementation, local settings, and an occasional side-game flow. The HTML references Cloudflare browser analytics. Those observations do not identify the origin host or database. [SongSpot homepage](https://songspot.net/), [game bundle](https://songspot.net/_next/static/chunks/07twa09qend_u.js)

## What was rebuilt locally

BeatGuessr implements the five clip stages, artist/title guesses, skip/reveal/new-round controls, exact scheduled audio windows, volume, randomized tracks, genre/year filters, and repeat avoidance. It adds pooled source selection with checkboxes, Spotify public-embed metadata import, CSV, local audio, and full-screen win confetti.

The built-in catalog starts with manually categorized songs. Expansion fetches artist top tracks and album dates from Deezer, rather than copying SongSpot's catalog. Provider preview URLs are refreshed as needed. Playlist metadata and catalog expansion are stored on this computer.

Spotify's official API has changed: new Development Mode apps face account and playlist-access restrictions, and the `/tracks` playlist route has an `/items` replacement. The published migration guidance and later updates distinguish new versus existing integrations. Separately, the developer policy prohibits games. A Spotify API token is not a dependable general-purpose game/audio solution here. [Migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide), [developer-access update](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security), [policy](https://developer.spotify.com/policy)

The included optional Spicetify CSV exporter uses `Platform.PlaylistAPI.getContents` to read playlist metadata. Spicetify's documentation distinguishes internal Spotify requests from ordinary external fetches because its Cosmos wrapper attaches authentication automatically. The exporter avoids sending those credentials to localhost. [Spicetify Cosmos documentation](https://spicetify.app/docs/development/api-wrapper/methods/cosmos-async)

## Reproduce the inspection

Run `node research/inspect-songspot.js` to capture ordinary initial-page API requests and a desktop screenshot. Raw captures and downloaded third-party bundles stay outside Git. The observations above describe those local captures; the inspection script can collect fresh browser observations. Hashed production asset URLs can change after a deployment. No bulk audio download or private endpoint enumeration was performed.
