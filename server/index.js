import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { genres, filterCatalog, mergeSongs } from "./catalog.js";
import { resolveSong, media, fetchAudio, searchSongs } from "./providers.js";
import { spotifyPlaylistId, parseSpotifyEmbed, parseCSV } from "./playlists.js";
import { WebSocketServer } from "ws";
import { LobbyHub } from "./lobbies.js";
import { createAccess } from "./access.js";
import { mergeSuggestions } from "../public/guess-search.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playlistPath = resolve(
  process.env.DATA_DIR || resolve(root, "data"),
  "playlists.json",
);
const publicOrigins = [process.env.APP_ORIGIN, process.env.RENDER_EXTERNAL_URL]
  .filter(Boolean)
  .join(",");
const access = createAccess({
  origin: publicOrigins,
  secret: process.env.SESSION_SECRET,
});
const visiblePlaylists = (owner) =>
  playlists.filter((p) => (p.ownerId || "local") === owner);
let playlists;
try {
  playlists = JSON.parse(await readFile(playlistPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  playlists = [];
}
let saveQueue = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(playlists, null, 2);
  saveQueue = saveQueue
    .catch(() => {})
    .then(async () => {
      await mkdir(dirname(playlistPath), { recursive: true });
      await writeFile(`${playlistPath}.tmp`, snapshot);
      await rename(`${playlistPath}.tmp`, playlistPath);
    });
  return saveQueue;
}
const audioCache = new Map();
const audioTasks = new Map();
async function audioFor(song) {
  const cached = audioCache.get(song.id);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached;
  if (audioTasks.has(song.id)) return audioTasks.get(song.id);
  const task = fetchAudio(song)
    .then((result) => {
      const entry = { ...result, at: Date.now() };
      audioCache.set(song.id, entry);
      while (audioCache.size > 20)
        audioCache.delete(audioCache.keys().next().value);
      return entry;
    })
    .finally(() => audioTasks.delete(song.id));
  audioTasks.set(song.id, task);
  return task;
}

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) {
      const error = new Error("Import is too large (4 MB maximum).");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON request.");
    error.status = 400;
    throw error;
  }
}
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".csv": "text/csv",
};

export const lobbies = new LobbyHub(async (seed) => {
  let track = await resolveSong(seed);
  try {
    return { track, audio: await audioFor(track) };
  } catch {
    track = await resolveSong(seed, track.source);
    return { track, audio: await audioFor(track) };
  }
});
function selectedPool(owner, sources) {
  if (!Array.isArray(sources) || sources.length > 30)
    throw new Error("Choose up to 30 playlists.");
  return mergeSongs(
    ...sources.map((id) => {
      const playlist = visiblePlaylists(owner).find((p) => p.id === id);
      if (!playlist) throw new Error("Playlist not found in your imports.");
      return playlist.tracks.map((track) => ({
        ...track,
        poolSources: [{ id, name: playlist.name }],
      }));
    }),
  );
}
export const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (
      req.method !== "GET" &&
      req.headers.origin &&
      !access.allowsOrigin(req.headers.origin)
    ) {
      return json(res, 403, {
        error: "Requests must come from this BeatGuessr site.",
      });
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    const owner = access.visitor(req, res);
    const ownPlaylists = visiblePlaylists(owner);
    if (req.method === "POST" && url.pathname === "/api/lobbies") {
      const input = await body(req);
      const { room, player } = lobbies.create(
        input.name,
        selectedPool(owner, input.sources),
        owner,
      );
      return json(res, 201, { code: room.code, token: player.token });
    }
    const lobbyRoute =
      /^\/api\/lobbies\/([A-Z0-9]{6})\/(audio|suggestions)(?:\/([^/]+))?$/.exec(
        url.pathname,
      );
    if (req.method === "GET" && lobbyRoute) {
      const { room } = lobbies.authorize(
        lobbyRoute[1],
        (req.headers.authorization || "").replace(/^Bearer /, ""),
      );
      if (lobbyRoute[2] === "suggestions") {
        const query = (url.searchParams.get("q") || "").trim().slice(0, 120);
        let external = [];
        if (query.length >= 2) {
          try {
            external = await searchSongs(query);
          } catch {}
        }
        return json(res, 200, {
          tracks: mergeSuggestions(room.pool, external, query).map(
            ({ id, title, artist }) => ({ id, title, artist }),
          ),
        });
      }
      if (!room.round?.audio || room.round.id !== lobbyRoute[3])
        return json(res, 404, { error: "Round audio is no longer available." });
      res.writeHead(200, {
        "Content-Type": room.round.audio.type,
        "Cache-Control": "private, no-store",
      });
      return res.end(room.round.audio.bytes);
    }
    if (req.method === "GET" && url.pathname === "/api/search") {
      const query = (url.searchParams.get("q") || "").trim();
      if (query.length > 120)
        return json(res, 400, {
          error: "Search must be 120 characters or fewer.",
        });
      return json(res, 200, { tracks: await searchSongs(query) });
    }
    if (req.method === "GET" && url.pathname === "/api/health")
      return json(res, 200, {
        ok: true,
        songs: mergeSongs(...ownPlaylists.map((p) => p.tracks)).length,
      });
    if (req.method === "GET" && url.pathname === "/api/catalog") {
      const sources = [
        ...new Set(
          (
            url.searchParams.get("sources") ??
            url.searchParams.get("source") ??
            ""
          )
            .split(",")
            .filter(Boolean),
        ),
      ];
      const collections = [];
      for (const source of sources) {
        const playlist = ownPlaylists.find((p) => p.id === source);
        if (!playlist)
          return json(res, 404, {
            error: "Playlist not found. Choose another source.",
          });
        collections.push(
          playlist.tracks.map((song) => ({
            ...song,
            poolSources: [
              {
                id: source,
                name: playlist.name,
              },
            ],
          })),
        );
      }
      const songs = mergeSongs(...collections);
      const tracks = filterCatalog(songs, Object.fromEntries(url.searchParams));
      return json(res, 200, {
        tracks,
        total: songs.length,
        genres: [...new Set([...genres, ...songs.map((t) => t.genre)])].sort(),
        duplicatesRemoved: collections.flat().length - songs.length,
        sources,
        note:
          sources.length === 1
            ? ownPlaylists.find((p) => p.id === sources[0])?.note || null
            : null,
      });
    }
    if (req.method === "GET" && url.pathname === "/api/playlists") {
      return json(res, 200, {
        playlists: ownPlaylists.map(({ tracks, ownerId, ...p }) => ({
          ...p,
          count: tracks.length,
          possiblyTruncated:
            p.possiblyTruncated ??
            (tracks.length >= 100 && tracks[0]?.origin === "spotify"),
        })),
      });
    }
    if (req.method === "POST" && url.pathname === "/api/playlists/import") {
      const input = await body(req);
      let playlist;
      if (typeof input.csv === "string")
        playlist = parseCSV(input.csv, input.name || "Imported playlist");
      else {
        const id =
          typeof input.url === "string" && spotifyPlaylistId(input.url.trim());
        if (!id)
          return json(res, 400, {
            error:
              "Paste a Spotify playlist URL, URI, or 22-character playlist ID.",
          });
        const response = await fetch(
          `https://open.spotify.com/embed/playlist/${id}`,
          { signal: AbortSignal.timeout(15000) },
        );
        if (!response.ok)
          throw new Error(
            "Could not open this public playlist. Check the link or use CSV import.",
          );
        playlist = parseSpotifyEmbed(await response.text(), id);
      }
      const old =
        playlist.spotifyUrl &&
        playlists.findIndex(
          (p) =>
            (p.ownerId || "local") === owner &&
            p.spotifyUrl === playlist.spotifyUrl,
        );
      playlist.ownerId = owner;
      if (typeof old === "number" && old >= 0) {
        playlist.id = playlists[old].id;
        playlists[old] = playlist;
      } else {
        if (ownPlaylists.length >= 30 || playlists.length >= 500)
          return json(res, 429, {
            error: "Import limit reached. Remove an unused playlist first.",
          });
        playlists.push(playlist);
      }
      await save();
      return json(res, 201, {
        playlist: {
          ...playlist,
          ownerId: undefined,
          tracks: undefined,
          count: playlist.tracks.length,
        },
      });
    }
    if (req.method === "DELETE" && url.pathname.startsWith("/api/playlists/")) {
      const id = url.pathname.slice("/api/playlists/".length);
      playlists = playlists.filter(
        (p) => p.id !== id || (p.ownerId || "local") !== owner,
      );
      await save();
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/resolve") {
      const input = await body(req);
      const seed = ownPlaylists
        .flatMap((p) => p.tracks)
        .find((t) => t.id === input.id);
      if (!seed)
        return json(res, 404, { error: "Song not found in your library." });
      return json(res, 200, {
        track: await resolveSong(seed, input.failedSource),
      });
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/audio/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/audio/".length));
      const song = media.get(id);
      if (!song)
        return json(res, 404, { error: "Preview expired. Start a new round." });
      const audio = await audioFor(song);
      res.writeHead(200, {
        "Content-Type": audio.type,
        "Content-Length": audio.bytes.length,
        "Cache-Control": "private, max-age=300",
      });
      return res.end(audio.bytes);
    }
    if (url.pathname.startsWith("/api/"))
      return json(res, 404, { error: "Unknown endpoint." });
    if (req.method !== "GET" && req.method !== "HEAD")
      return json(res, 405, { error: "Method not allowed." });
    const relative = /^\/lobby(?:\/[A-Z0-9]{6})?\/?$/i.test(url.pathname)
      ? "lobby.html"
      : url.pathname === "/"
        ? "index.html"
        : decodeURIComponent(url.pathname).slice(1);
    const publicRoot = resolve(root, "public");
    const file = resolve(publicRoot, relative);
    if (
      !file.startsWith(publicRoot + "\\") &&
      !file.startsWith(publicRoot + "/")
    )
      return json(res, 403, { error: "Invalid path." });
    try {
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": `${types[extname(file)] || "application/octet-stream"}; charset=utf-8`,
      });
      return res.end(req.method === "HEAD" ? undefined : data);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return json(res, 404, { error: "File not found." });
    }
  } catch (error) {
    json(res, error.status || 502, {
      error: error.message || "Something went wrong. Try again.",
    });
  }
});

const sockets = new WebSocketServer({ noServer: true, maxPayload: 8192 });
server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/ws/lobby" || !access.allowsOrigin(req.headers.origin)) {
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(req, socket, head, (ws) =>
    sockets.emit("connection", ws),
  );
});
sockets.on("connection", (ws) => {
  ws.alive = true;
  ws.on("pong", () => {
    ws.alive = true;
  });
  let member,
    count = 0,
    windowStart = Date.now();
  const send = (value) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(value));
  };
  const authTimeout = setTimeout(() => {
    if (!member) ws.close(1008, "Join a room first");
  }, 10000);
  authTimeout.unref();
  ws.on("error", () => {});
  ws.on("message", async (data) => {
    try {
      if (Date.now() - windowStart > 10000) {
        count = 0;
        windowStart = Date.now();
      }
      if (++count > 40) throw new Error("Too many requests. Wait a moment.");
      const action = JSON.parse(data.toString());
      if (!action || typeof action.type !== "string")
        throw new Error("Invalid lobby action.");
      if (!member) {
        if (action.type !== "join") throw new Error("Join a lobby first.");
        const room = lobbies.get(action.code);
        const player = lobbies.join(room.code, action.name, action.token);
        const previous = player.socket;
        player.socket = ws;
        previous?.close(4000, "Session opened in another tab");
        member = { room, player };
        clearTimeout(authTimeout);
        send({ type: "joined", code: room.code, token: player.token });
        lobbies.connect(room, player, send);
      } else {
        if (
          !lobbies.rooms.has(member.room.code) ||
          !member.room.players.has(member.player.id)
        )
          throw new Error("Lobby expired. Join a new room.");
        await lobbies.command(member.room, member.player, action);
        if (action.type === "leave") ws.close(1000, "Left lobby");
      }
    } catch (error) {
      send({
        type: "error",
        message: error.message || "Lobby request failed.",
      });
    }
  });
  ws.on("close", () => {
    clearTimeout(authTimeout);
    if (
      member &&
      member.player.socket === ws &&
      member.room.players.has(member.player.id)
    )
      lobbies.disconnect(member.room, member.player);
  });
});
const roomCleanup = setInterval(() => lobbies.prune(), 60000);
roomCleanup.unref();
const heartbeat = setInterval(() => {
  for (const ws of sockets.clients) {
    if (!ws.alive) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
}, 15000);
heartbeat.unref();
server.on("close", () => {
  clearInterval(roomCleanup);
  clearInterval(heartbeat);
  for (const ws of sockets.clients) ws.terminate();
  sockets.close();
});

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 3000);
  server.listen(port, process.env.HOST || "127.0.0.1", () =>
    console.log(`BeatGuessr is ready at http://localhost:${port}`),
  );
}
