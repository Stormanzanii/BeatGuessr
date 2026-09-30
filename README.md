# BeatGuessr

A localhost song guessing game with 0.1, 0.5, 2, 8, and 15 second clips. Combine Spotify playlists, filter by genre or year, or play from your own audio files.

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

The server listens on `127.0.0.1`, so it is accessible only on the computer running it. A fresh installation starts with 233 built-in songs. To expand the catalog, open **Manage imports & more songs → Get more built-in songs**, wait for it to finish, then click **Apply & new song**. Provider availability determines how many additional tracks are found. Personal playlists and generated catalog data are not bundled with the repository.

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

Then open http://localhost:3001. `PORT` is the only configuration variable; no `.env` file is required.

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

Press Play, then type a title or choose a suggestion. Enter submits your guess. Skip, beside the textbox, advances through the clip lengths. At 15 seconds it reveals the answer. You can also choose a clip length directly. Correct answers animate the record and release confetti in five overlapping bursts across the screen for 12 seconds. The saved slider under Audio & celebration settings runs from 1× (1,500 pieces) to 20× (30,000 pieces); the default 6× keeps the previous 9,000-piece celebration. Reduced-motion preferences use a smaller, shorter celebration.

Open Sources and check one or more collections. Press Apply & new song to shuffle their combined pool. Overlapping songs are deduplicated, so the same song appearing in two playlists does not receive double the chance of selection. Genre and year controls are under Genre & release years. The app avoids recently served songs until the selected pool is exhausted.

A correct guess automatically plays a 30-second snippet alongside the celebration. Shorter previews or local files play their available duration. Use the play button to stop or replay the snippet; Next song stops it immediately. A late random starting point shifts back when needed to leave room for the full snippet. Revealing an unsolved song does not trigger automatic playback.

## Music sources

- **Built-in songs:** 233 hand-selected tracks with original release years, plus the locally expanded catalog. Manage imports & more songs → Get more built-in songs fetches popular tracks for the built-in artists and their album dates from Deezer. The expanded catalog is saved in `data/expanded-catalog.json`. These additional dates describe the provider's album edition and can be reissue dates. Genre is inherited from the seed artist category.
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

Then right-click a playlist in Spotify and choose **Export for BeatGuessr**. Import the downloaded CSV here. Applying Spicetify can restart Spotify. This optional integration has not been validated in a live Spotify session; its internal API can change between Spotify versions.

Spotify's [developer policy](https://developer.spotify.com/policy) prohibits games, including trivia. Its official Web API is therefore not used as the audio/game backend. Public embed parsing is an unofficial metadata import path and is not a statement of Spotify approval. CSV and local-file imports remain independent of that parser.

## Project layout

| Location                                    | Responsibility                                                   |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `public/app.js`                             | Game flow, combined source selection, guesses, imports, settings |
| `public/audio.js`                           | Decoding and audio-clock scheduling                              |
| `public/confetti.js`                        | Full-screen win celebration                                      |
| `public/style.css`, `public/layout.css`     | Flat styling, equal-height desktop panels, responsive layout     |
| `server/index.js`                           | Local HTTP server, API, persistence, restricted audio proxy      |
| `server/catalog.js`, `server/library.js`    | Seed songs, deduplication, catalog expansion                     |
| `server/providers.js`, `server/matching.js` | Preview lookup, matching, expiring URL refresh                   |
| `server/playlists.js`                       | Spotify embed and CSV parsing                                    |
| `research/songspot-analysis.md`             | Public-client reverse engineering and evidence                   |

No accounts, database service, API keys, or frontend build step are required. Settings and the most recent 2,000 served song IDs are stored in browser localStorage. Session scores reset on reload. Playlist metadata is saved to `data/playlists.json`. Decoded previews and a bounded server audio cache are transient. Network access is required for provider previews and imports; imported local audio can play offline once the local app is open.

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
