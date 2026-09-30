# BeatGuessr

A song guessing game with solo play and multiplayer lobbies. Guess from 0.1, 0.5, 2, 8, and 15 second clips. Combine Spotify playlists, filter by genre or year, or play from your own audio files in solo mode.

## Setup

### Requirements

- [Node.js](https://nodejs.org/en/download) 22 or newer, including npm.
- [Git](https://git-scm.com/downloads) to clone the repository, or download its ZIP from GitHub.
- A current browser with Web Audio support, such as Firefox, Zen, Chrome, or Edge.
- Internet access for song previews and Spotify imports. No API keys or Spotify Premium account are needed to run this client.

### Install and start

Run these commands in PowerShell, Terminal, or your preferred shell:

```sh
git clone https://github.com/Stormanzanii/BeatGuessr.git
cd BeatGuessr
npm ci
npm start
```

Open **http://localhost:3000**. Leave the terminal running while you play. Press **Ctrl+C** in that terminal to stop the server. For later sessions, open a terminal in the project folder and run `npm start` again.

If you downloaded a ZIP, extract it and open a terminal in the folder containing `package.json`, then run `npm ci` and `npm start`.

By default the server listens on `127.0.0.1`, so it is accessible only on the computer running it. Start with the built-in Popular collection, import a Spotify playlist or CSV, or add local audio. Popular is available in solo and multiplayer and can be combined with imported playlists. Personal playlists are not bundled with the repository. For online play, see [Deploy on Render](#deploy-on-render).

### Use another port

If port 3000 is already in use, stop the other server or choose another port.

PowerShell:

```powershell
$env:PORT = "3001"
npm start
```

macOS or Linux:

```sh
PORT=3001 npm start
```

Then open http://localhost:3001. No `.env` file is required for local use. Deployment also supports `HOST`, `APP_ORIGIN`, `SESSION_SECRET`, and `DATA_DIR` as described below.

### Update or develop

To update an existing checkout, stop the server and run:

```sh
git pull --ff-only
npm ci
npm start
```

Use `npm run dev` to restart the server automatically when server files change. Refresh the browser after frontend changes. There is no frontend build step.

### Troubleshooting

| Problem                                                   | What to do                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `node`, `npm`, or `git` is not recognized                 | Install the missing requirement, reopen your terminal, then check `node --version`, `npm --version`, and `git --version`. |
| PowerShell blocks `npm.ps1`                               | Use `npm.cmd ci` and `npm.cmd start`, or run the commands in Command Prompt.                                              |
| `EADDRINUSE` on startup                                   | Stop the process using that port or follow the alternate-port instructions above.                                         |
| No songs match the filters                                | Select at least one source and widen the year range. Imported songs with unknown metadata need All years and All genres.  |
| A public Spotify playlist imports only part of its tracks | Use a complete CSV export instead. Public embeds can truncate playlists.                                                  |
| Audio cannot load                                         | Try New song, check your connection, or import a local audio file. Not every song has a matching preview in every region. |
| The page shows an older layout                            | Refresh the browser; use Ctrl+Shift+R for a full reload.                                                                  |

## Play

Press Play, then type a title or choose a suggestion. Suggestions combine the wider Deezer catalog, with Apple Music as a fallback, and matching songs from your selected sources. Exact playlist title matches appear first, including tracks missing from the external catalog. If external search is unavailable, matching playlist songs still appear and you can enter a title directly. Enter submits your guess. Skip, beside the textbox, advances through the clip lengths. At 15 seconds it reveals the answer. You can also choose a clip length directly.

Correct answers animate the record and release confetti. The saved slider under Audio & celebration settings runs from 1× (1,500 pieces for two seconds) to 20× (30,000 pieces). Duration increases by two seconds per multiplier and caps at 12 seconds; the default is 1×. Reduced-motion preferences use a smaller, shorter celebration.

Open Sources and check one or more collections. Press Apply & new song to shuffle their combined pool. Overlapping songs are deduplicated, so the same song appearing in two playlists does not receive double the chance of selection. Genre and year controls are under Genre & release years. The app avoids recently served songs until the selected pool is exhausted.

Revealing a song puts the album artwork on the centre record, with the title, artist, album/year, source, and listening links underneath. Every reveal automatically plays a 30-second snippet, including rounds nobody solved. The record spins during playback. Shorter previews or local files play their available duration. Use the play button to stop or replay the snippet; Next song stops it immediately. A late random starting point shifts back when needed to leave room for the full snippet.

While you play, the next song's audio is downloaded and decoded, and artwork loads ahead of the reveal. Solo mode cancels old preloads when you change the collection or filters. Each lobby client holds only the current and upcoming round's media; it reuses the prepared audio when the host starts the next round. Track titles remain withheld from lobby clients until the reveal.

**Random starting point** persists across refreshes and applies when a prepared song becomes the active round. A readout shows where the guessing clips start. The point stays the same across replays and longer clips within a round. It randomizes within the available preview (or your full local file), not the entire Spotify song. Audio of at least 16 seconds leaves room for all five clip lengths; shorter previews still randomize, with the play button showing the shorter available duration. The 30-second reveal may start earlier to fit. Lobby hosts can enable random starts when creating a room; everyone shares the same point.

Incorrectly guessed songs remain in the search dropdown, greyed out with an **Already guessed · incorrect** label. Clicking and keyboard selection skip them. The marks reset each round. In lobbies, each player sees only their own incorrect guesses, and those marks survive reconnecting.

Waveform checks move the starting point past silence so the first 0.1-second clip contains sound. The same point is used for longer clips. Entirely silent or near-silent audio is rejected. In lobbies, the host's checked position is shared with everyone, including personal replays.

Advancing a clip continues from where playback stopped, up to the new total length: after hearing 0.1s, advancing to 0.5s plays the next 0.4s. A replay restarts from the round's starting point. Multiplayer keeps each player's listening position separately.

## Play with friends

Open **Play with friends**, enter a nickname, choose imported playlists, and create a room. Send **Copy invite** to your friends or share the six-character room code. Up to 16 players can join, including the host. Each player clicks Join to enable browser audio.

Every player has a **Play clip** button that plays or stops audio only for them. The host also has controls to play or stop audio for everyone, start rounds, advance clips, and reveal the answer. Everyone guesses independently. Correct guesses earn 100 / 80 / 60 / 40 / 20 points at the five clip lengths; answers stay private until everyone connected solves or the host reveals. Every connected player must vote to start a shared **30-second countdown** before the next clip, including players who have already guessed correctly. Players can continue guessing and replaying during the countdown. At the final 15-second stage, the countdown reveals the answer instead. Refreshing, reconnecting, or additional votes do not restart the countdown. A host advance or everyone solving cancels it. Every reveal plays up to 30 seconds, whether anyone solved it or not.

The server checks guesses and permissions. Clients preload the same audio and schedule playback using a shared timestamp, with clock-offset and late-arrival adjustment. Network and browser scheduling can still introduce small timing differences. A disconnected player can rejoin from the same tab with their score intact. The host has a 30-second reconnection grace period after a detected disconnect; controls then pass to another connected player. Leaving transfers controls immediately.

Rooms expire after two hours without activity and are held in server memory. Lobbies use Popular or imported playlist previews; local audio remains a solo feature. Hosted imports belong to the browser that imported them, while invited room members can guess from the host's selected songs. Clearing browser cookies loses access to those hosted imports.

## Deploy on Render

[Deploy this repository on Render](https://render.com/deploy?repo=https://github.com/Stormanzanii/BeatGuessr) using the included `render.yaml`. It creates **one Free Node web service** in Singapore, with no paid disk or database. Build: `npm ci --omit=dev`. Start: `npm start`. Health check: `/api/health`.

The Blueprint sets `HOST=0.0.0.0`, `APP_ORIGIN=https://beatguessr.clypdat.xyz`, and generates `SESSION_SECRET` for signed browser sessions. Render supplies `PORT` and `RENDER_EXTERNAL_URL`; its default service URL is also accepted as an application origin. `DATA_DIR` optionally selects a playlist storage directory when using persistent hosting. Use one server instance: active rooms are not shared across instances.

Render's [Free tier](https://render.com/docs/free) sleeps after 15 minutes without inbound traffic and takes about a minute to wake. Its filesystem is ephemeral: imports and rooms are lost on a restart, redeploy, or sleep. Keep your CSV exports so the host can reimport them. This setup has no persistent-storage guarantee.

After the service is deployed:

1. Check `beatguessr.clypdat.xyz` under the Render service's **Settings → Custom Domains**. The Blueprint declares this domain automatically.
2. In Cloudflare's DNS for `clypdat.xyz`, create a **CNAME** named `beatguessr` pointing to the exact `…onrender.com` hostname assigned to the service. Start with **DNS only** and automatic TTL.
3. Verify the domain in Render and wait for its managed HTTPS certificate. See [Render's custom-domain documentation](https://render.com/docs/custom-domains).
4. Open `https://beatguessr.clypdat.xyz`, import your playlists, then create a lobby. Invite links use `/lobby/ROOMCODE` on the current hostname.

The CNAME target must come from the actual deployment; the repository does not assume that a particular Render hostname is available.

## Music sources

The revealed answer shows which selected source supplied the song: the playlist name or Local audio. A song shared by multiple selected sources lists each source once. Deezer or Apple Music listening links identify the audio provider separately.

- **Public Spotify playlists:** paste a playlist URL, URI, or ID. The importer reads the metadata exposed by Spotify's public embed. Embeds can stop at 100 tracks and do not guarantee the complete playlist. They generally omit release years and genres. This is not an official Spotify Web API integration.
- **CSV:** import complete or private playlists with `Title,Artist,Year,Genre` columns. Only Title and Artist are required. Common export headers such as Track Name, Artist Name(s), Album Release Date, and Track URI are also accepted. Quoted fields and duplicate rows are handled. See `public/example-playlist.csv`.
- **Local audio:** add MP3, M4A, WAV, OGG, or another browser-supported audio format. Files remain in browser memory for that session. Filenames are parsed as `Artist - Title.ext`. Embedded tags are not read; local files have unknown genre and year.

Imported playlists are automatically combined with the currently selected imported playlists. Select or deselect individual sources using their checkboxes. Stored imports survive server restarts; local audio files must be selected again after a page reload.

Tracks with unknown years are included with All years and excluded from narrower ranges. Unknown genres appear under All genres or Unknown. A CSV containing those fields is the most reliable way to filter an imported playlist.

Audio is matched to public Deezer or Apple Music preview excerpts. Matching requires both artist and title and rejects karaoke/tribute results. Missing or failed previews are skipped after bounded retries. The game does not depend on SongSpot's API or audio server. It does not play Spotify streams.

Preview excerpts usually start in the middle of the recording. **Use local audio for actual song intros.** Random starting point picks a fixed offset for that round, leaving room for the 15-second stage. The Web Audio clock, rather than a JavaScript timeout, controls clip duration. Short local files play only as much audio as they contain.

## Spicetify export

An optional Spicetify exporter is included at `public/spicetify/beatguessr-export.js`. It registers a playlist context-menu action, reads metadata through `Spicetify.Platform.PlaylistAPI` in pages, and downloads a CSV for import into BeatGuessr. It does not export account credentials or audio.

To install it on Windows:

```powershell
Copy-Item -LiteralPath './public/spicetify/beatguessr-export.js' -Destination "$env:APPDATA/spicetify/Extensions/beatguessr-export.js"
spicetify config extensions beatguessr-export.js
spicetify apply
```

All three commands are needed: copying or downloading the file only installs it on disk. `spicetify config extensions beatguessr-export.js` enables the extension alongside your existing extensions, and `spicetify apply` loads it into Spotify and restarts the client. If the export menu is missing, run `spicetify config extensions` and check that `beatguessr-export.js` appears in the list, then run `spicetify apply` again.

Then right-click a playlist in Spotify and choose **Export for BeatGuessr**. Import the downloaded CSV here. The exporter reads successive pages, including when Spotify returns fewer entries than requested. It supports up to 10,000 entries and stops with an error if pages repeat or end before the reported total. It includes the original playlist URL, so importing its CSV replaces the matching partial Spotify import while keeping the source selected.

Applying Spicetify can restart Spotify. Pagination is covered by automated tests, including a 350-song playlist, but this optional integration has not been validated in a live Spotify session; its internal API can change between Spotify versions.

### Why pasted Spotify links can stop at 100 songs

The public embed used by link imports returns at most 100 tracks for the large playlists tested. Adding `offset=100&limit=100` returned the same first 100 tracks, and the embed supplied no next-page link or total count. The app marks these imports as potentially incomplete. Its CSV importer accepts up to 10,000 songs; the game pool itself has no 100-song limit.

For a complete playlist, install the Spicetify exporter above, export from the desktop app, then choose **Import Spotify playlist / CSV → Choose CSV file**. Spotify's separate [playlist items API](https://developer.spotify.com/documentation/web-api/reference/get-playlists-items) has authenticated pagination, but it is not used by the public-link importer.

Spotify's [developer policy](https://developer.spotify.com/policy) prohibits games, including trivia. Its official Web API is therefore not used as the audio/game backend. Public embed parsing is an unofficial metadata import path and is not a statement of Spotify approval. CSV and local-file imports remain independent of that parser.

## Project layout

| Location                                    | Responsibility                                                   |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `public/app.js`                             | Game flow, combined source selection, guesses, imports, settings |
| `public/audio.js`                           | Decoding and audio-clock scheduling                              |
| `public/confetti.js`                        | Full-screen win celebration                                      |
| `public/style.css`, `public/layout.css`     | Flat styling, equal-height desktop panels, responsive layout     |
| `server/index.js`                           | HTTP/WebSocket server, API, persistence, restricted audio proxy  |
| `server/lobbies.js`, `server/access.js`     | Room rules, scoring, host permissions, signed browser sessions   |
| `public/lobby.js`, `public/lobby.html`      | Room setup, shared playback, guesses, votes, and scoreboard      |
| `render.yaml`                               | Free Render deployment configuration                             |
| `server/catalog.js`                         | Song deduplication and genre/year filtering                      |
| `server/providers.js`, `server/matching.js` | Preview lookup, matching, expiring URL refresh                   |
| `server/playlists.js`                       | Spotify embed and CSV parsing                                    |
| `research/songspot-analysis.md`             | Public-client reverse engineering and evidence                   |

No player accounts, database service, music API keys, or frontend build step are required. Settings and the most recent 2,000 served song IDs are stored in browser localStorage. Solo session scores reset on reload; lobby scores remain on the running server and rejoining uses a token stored in that tab's sessionStorage. Playlist metadata is saved to `data/playlists.json` or `DATA_DIR`. Decoded previews and a bounded server audio cache are transient. Network access is required for provider previews and imports; imported local audio can play offline once the local app is open.

## Check

Unit tests do not need the server:

```sh
npm test
```

For the browser checks, keep `npm start` running on port 3000 in one terminal. In a second terminal in the project folder, run:

```sh
npx playwright install chromium
npm run test:browser
```

Keep the server running for browser tests. They use real provider audio and create/delete their own CSV test playlists. Checks cover all five clip schedules, skip and guess progression, correct-answer confetti, combined playlist deduplication, source checkboxes, year/genre filters, aligned desktop panels, mobile overflow, and browser errors. Screenshots are written to `test-results/`. Provider availability can affect the live tests.

`npm run test:lobby` starts its own server with temporary storage and deterministic audio, then opens four independent browser sessions. It checks private imports, joining, host permissions, shared playback timestamps, votes, scores, solved and unsolved 30-second reveals, host transfer, rejoining, and mobile layout. It requires Playwright Chromium but no running app or music-provider connection.

It also checks audio/artwork preloading and random-start persistence across refreshes and prepared rounds. To run the same checks in Firefox, install it with `npx playwright install firefox` and set `BEATGUESSR_TEST_BROWSER=firefox` for the test command.
