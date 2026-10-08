import { ClipPlayer } from "./audio.js";
import { celebrate, confettiMultiplier } from "./confetti.js";
import { wasGuessedWrong, nextEnabledSuggestion } from "./guess-history.js";
import { restoredPlaylists, rememberPlaylist, cacheErrorMessage } from "./library-cache.js";
import { spotifyAppURL } from "./spotify-links.js";

const $ = (id) => document.getElementById(id);
const stored = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const settings = stored("beatguessr:settings", {});
let socket,
  state,
  code = location.pathname.split("/")[2]?.toUpperCase() || "",
  token = "",
  stopped = false;
let loadingRound = "",
  loadedRound = "",
  playbackId = "",
  audioTask = 0,
  serverOffset = 0,
  pingTimer,
  reconnectTimer;
let readySentForRound = "";
let suggestions = [],
  suggestionIndex = -1,
  searchTimer,
  searchRequest = 0,
  searchController;
const celebrated = new Set();
const mediaCache = new Map();
const player = new ClipPlayer(
  (progress) => ($("room-progress").style.width = `${progress * 100}%`),
  (playing) => {
    $("lobby-record").classList.toggle("spinning", playing);
    updatePersonalPlayback();
  },
);
window.beatguessrLobby = {
  player,
  get state() {
    return state;
  },
  get preloaded() {
    return [...mediaCache].map(([id, entry]) => ({
      id,
      audio: !!entry.buffer,
      artwork: !!entry.image,
    }));
  },
};
$("room-code").value = code;
$("nickname").value = stored("beatguessr:nickname", "");
$("room-random-start").checked = settings.randomStart === true;
$("room-playlist-mode").value = settings.playlistMode === "alternating" ? "alternating" : "equal";
$("room-volume").value = settings.volume ?? 60;
player.setVolume(Number($("room-volume").value) / 100);
function error(message = "") {
  $("lobby-error").textContent = message;
}
async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
async function sources(selected) {
  const data = await restoredPlaylists(request);
  if (data.warning) error(data.warning);
  const options = [...(data.builtIns || []), ...data.playlists];
  let chosen = [...new Set((selected || settings.sources || [])
    .map((id) => data.sourceMap.get(id) || id))];
  if (!chosen.some((id) => options.some((option) => option.id === id)))
    chosen = ["curated"];
  $("lobby-sources").replaceChildren();
  for (const playlist of options) {
    const label = document.createElement("label"),
      input = document.createElement("input"),
      text = document.createElement("span");
    input.type = "checkbox";
    input.value = playlist.id;
    input.checked = chosen.includes(playlist.id);
    text.textContent = `${playlist.name} · ${playlist.count} songs`;
    label.append(input, text);
    $("lobby-sources").append(label);
  }
  if (!options.length)
    $("lobby-sources").textContent =
      "Import a CSV or add a Spotify playlist in solo mode first.";
}
function send(type, extra = {}) {
  if (socket?.readyState !== WebSocket.OPEN) {
    error("Reconnecting to the room…");
    return;
  }
  socket.send(JSON.stringify({ type, roundId: state?.round?.id, ...extra }));
}
function remember() {
  sessionStorage.setItem(`beatguessr:room:${code}`, token);
}
async function unlock() {
  await player.unlock();
  $("enable-audio").hidden = true;
}
function connect() {
  clearTimeout(reconnectTimer);
  clearInterval(pingTimer);
  $("connection").textContent = "Connecting…";
  socket = new WebSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws/lobby`,
  );
  const current = socket;
  socket.addEventListener("open", () => {
    send("join", {
      code,
      name: $("nickname").value,
      token: token || undefined,
    });
    send("ping", { sent: Date.now() });
    pingTimer = setInterval(() => send("ping", { sent: Date.now() }), 15000);
  });
  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "joined") {
      code = data.code;
      token = data.token;
      remember();
      history.replaceState(null, "", `/lobby/${code}`);
      $("setup").hidden = true;
      $("room").hidden = false;
      $("connection").textContent = "Connected";
      error();
      readySentForRound = "";
    } else if (data.type === "state") {
      if (!state) serverOffset = data.state.serverNow - Date.now();
      const wrongChanged =
        JSON.stringify(state?.wrongGuesses) !==
        JSON.stringify(data.state.wrongGuesses);
      state = data.state;
      render();
      if (wrongChanged && suggestions.length) renderSuggestions();
    } else if (data.type === "pong")
      serverOffset = data.serverNow - (data.sent + Date.now()) / 2;
    else if (data.type === "guess-result") {
      $("guess-feedback").textContent = data.message;
      $("guess-feedback").classList.toggle("correct", data.correct);
      if (data.correct && !celebrated.has(state.round.id)) {
        celebrated.add(state.round.id);
        celebrate(confettiMultiplier(settings.confettiMultiplier ?? 1));
      }
    } else if (data.type === "error") {
      error(data.message);
      if (/expired|not found|session opened/i.test(data.message)) {
        stopped = true;
        pruneMedia();
        sessionStorage.removeItem(`beatguessr:room:${code}`);
        token = "";
        state = null;
        audioTask++;
        loadingRound = "";
        loadedRound = "";
        $("setup").hidden = false;
        $("room").hidden = true;
        current.close();
      }
    }
  });
  socket.addEventListener("close", (event) => {
    if (current !== socket) return;
    clearInterval(pingTimer);
    player.stop();
    playbackId = "";
    $("connection").textContent = "Disconnected";
    if (event.code === 4000) {
      stopped = true;
      error("This room was opened in another tab.");
    }
    if (!stopped && token) reconnectTimer = setTimeout(connect, 1500);
    else if (!state) {
      $("join-room").disabled = false;
      $("create-room").disabled = false;
    }
  });
  socket.addEventListener("error", () =>
    error("Could not connect. Check your connection and try joining again."),
  );
}
async function enter(create) {
  try {
    error();
    await unlock();
    const name = $("nickname").value.trim();
    if (!name) throw new Error("Enter a nickname first.");
    localStorage.setItem("beatguessr:nickname", JSON.stringify(name));
    if (create) {
      const selected = [
        ...$("lobby-sources").querySelectorAll("input:checked"),
      ].map((input) => input.value);
      const created = await request("/api/lobbies", {
        method: "POST",
        body: JSON.stringify({
          name,
          sources: selected,
          randomStart: $("room-random-start").checked,
          playlistMode: $("room-playlist-mode").value,
        }),
      });
      code = created.code;
      token = created.token;
      localStorage.setItem(
        "beatguessr:settings",
        JSON.stringify({
          ...stored("beatguessr:settings", {}),
          sources: selected,
          randomStart: $("room-random-start").checked,
          playlistMode: $("room-playlist-mode").value,
        }),
      );
    } else {
      code = $("room-code").value.trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code))
        throw new Error("Enter the six-character room code.");
      token = sessionStorage.getItem(`beatguessr:room:${code}`) || "";
    }
    stopped = false;
    $("join-room").disabled = true;
    $("create-room").disabled = true;
    connect();
  } catch (e) {
    error(e.message);
  }
}
function clearSuggestions() {
  clearTimeout(searchTimer);
  searchRequest++;
  searchController?.abort();
  suggestions = [];
  suggestionIndex = -1;
  $("room-suggestions").replaceChildren();
  $("room-suggestions").hidden = true;
  $("room-guess").setAttribute("aria-expanded", "false");
  $("room-guess").removeAttribute("aria-activedescendant");
}
function pruneMedia(keep = []) {
  for (const [id, entry] of mediaCache)
    if (!keep.includes(id)) {
      entry.controller.abort();
      if (entry.artworkURL) URL.revokeObjectURL(entry.artworkURL);
      mediaCache.delete(id);
    }
}
function warmMedia(round) {
  if (mediaCache.has(round.id)) return mediaCache.get(round.id);
  const entry = { controller: new AbortController() };
  const signal = entry.controller.signal,
    headers = { Authorization: `Bearer ${token}` };
  mediaCache.set(round.id, entry);
  entry.audio = (async () => {
    const response = await fetch(`/api/lobbies/${code}/audio/${round.id}`, {
      signal,
      headers,
    });
    if (!response.ok)
      throw new Error("Audio could not load. Use Enable audio to retry.");
    const buffer = await player.decode(await response.arrayBuffer());
    signal.throwIfAborted();
    entry.buffer = buffer;
    return buffer;
  })();
  void entry.audio.catch((error) => {
    entry.error = error;
  });
  if (round.artwork)
    void (async () => {
      try {
        const response = await fetch(
          `/api/lobbies/${code}/artwork/${round.id}`,
          { signal, headers },
        );
        if (!response.ok || response.status === 204) return;
        const blob = await response.blob();
        signal.throwIfAborted();
        entry.artworkURL = URL.createObjectURL(blob);
        const image = new Image();
        image.src = entry.artworkURL;
        await image.decode();
        signal.throwIfAborted();
        entry.image = image;
        if (state?.round?.id === round.id) {
          $("lobby-cover").src = entry.artworkURL;
          $("lobby-cover").hidden = state.round.phase !== "revealed";
        }
      } catch {
        /* Keep the vinyl label if an artwork provider is unavailable. */
      }
    })();
  return entry;
}
async function loadAudio(round) {
  if (loadingRound === round.id || loadedRound === round.id) return;
  const requestId = ++audioTask;
  loadingRound = round.id;
  player.stop();
  playbackId = "";
  try {
    if (mediaCache.get(round.id)?.error) {
      const failed = mediaCache.get(round.id);
      failed.controller.abort();
      if (failed.artworkURL) URL.revokeObjectURL(failed.artworkURL);
      mediaCache.delete(round.id);
    }
    const asset = warmMedia(round);
    const buffer = asset.buffer || (await asset.audio);
    if (requestId !== audioTask || state?.round?.id !== round.id) return;
    player.setBuffer(buffer, state.randomStart);
    if (asset.artworkURL) $("lobby-cover").src = asset.artworkURL;
    loadedRound = round.id;
    loadingRound = "";
    updatePersonalPlayback();
    markReady();
    playScheduled();
  } catch (e) {
    if (requestId === audioTask) {
      loadingRound = "";
      error(e.message);
      $("enable-audio").hidden = false;
    }
  }
}
function markReady() {
  if (
    loadedRound &&
    loadedRound === state?.round?.id &&
    readySentForRound !== loadedRound
  ) {
    readySentForRound = loadedRound;
    send("ready", {
      duration: player.buffer.duration,
      startOffset: player.offset,
    });
  }
}
function playScheduled() {
  const playback = state?.round?.playback;
  if (!playback) {
    if (playbackId) {
      playbackId = "";
      player.stop();
    }
    return;
  }
  if (playback.stopped) {
    if (playbackId !== playback.id) {
      playbackId = playback.id;
      player.stop();
    }
    return;
  }
  if (loadedRound !== state.round.id || playbackId === playback.id) return;
  if (player.context?.state !== "running") {
    $("enable-audio").hidden = false;
    return;
  }
  playbackId = playback.id;
  const delay = (playback.startsAt - (Date.now() + serverOffset)) / 1000;
  const elapsed = Math.max(0, -delay),
    seconds = playback.seconds - elapsed;
  if (seconds <= 0 || playback.offset + elapsed >= player.buffer.duration)
    return;
  const clip = playback.continueFromPrevious
    ? player.continuation(playback.seconds, playback.offset)
    : { seconds, offset: playback.offset + elapsed };
  void player
    .play(clip.seconds, {
      offset: clip.offset,
      when: player.context.currentTime + Math.max(0, delay),
    })
    .catch((e) => error(e.message));
}
function updatePersonalPlayback() {
  const round = state?.round;
  $("play-clip").disabled =
    !round ||
    round.phase === "loading" ||
    loadedRound !== round.id ||
    round.offset == null ||
    !round.timingReady;
  $("play-clip").textContent = player.playing
    ? "Stop clip"
    : round?.phase === "revealed"
      ? "Replay snippet"
      : "Play clip";
}
async function playPersonalClip() {
  if ($("play-clip").disabled) return;
  if (player.playing) return player.stop();
  const round = state.round;
  try {
    await unlock();
    if (
      state.round?.id !== round.id ||
      state.round.stage !== round.stage ||
      state.round.phase !== round.phase
    )
      return;
    const revealed = round.phase === "revealed";
    await player.play(revealed ? 30 : round.seconds, {
      offset: revealed
        ? Math.min(round.offset, Math.max(0, player.buffer.duration - 30))
        : round.offset,
    });
  } catch (e) {
    error(e.message);
  }
}
function updateCountdown() {
  const round = state?.round,
    countdown = $("skip-countdown");
  countdown.hidden = round?.phase !== "guessing" || round.skipAt == null;
  if (countdown.hidden) return;
  const seconds = Math.min(
    30,
    Math.max(0, Math.ceil((round.skipAt - Date.now() - serverOffset) / 1000)),
  );
  countdown.textContent = seconds
    ? `${round.stage === 4 ? "Answer reveals" : "Longer clip"} in ${seconds}s · Keep guessing!`
    : "Advancing…";
}
setInterval(updateCountdown, 250);
function render() {
  const round = state.round,
    me = state.players.find((p) => p.id === state.you),
    host = state.you === state.hostId;
  $("code-label").textContent = code;
  $("room-message").textContent = state.message;
  $("round-title").textContent = round
    ? `Round ${round.number}`
    : "Ready when you are.";
  $("host-controls").hidden = !host;
  $("host-next").hidden = !!round && round.phase !== "revealed";
  $("host-next").textContent = round ? "Next song" : "Start round";
  const playable = round && round.phase !== "loading";
  for (const id of ["host-play", "host-stop", "host-skip", "host-reveal"])
    $(id).disabled = !playable;
  $("host-play").disabled =
    !playable || state.players.some((p) => p.connected && !p.ready);
  $("host-play").textContent =
    round?.phase === "revealed" ? "Replay for everyone" : "Play for everyone";
  $("host-skip").hidden = $("host-reveal").hidden =
    round?.phase === "revealed" || !round;
  const guessing = round?.phase === "guessing" && !me?.solved;
  $("room-guess").disabled = $("room-submit").disabled = !guessing;
  $("room-guess-form").hidden = round?.phase === "revealed";
  $("vote-skip").disabled =
    round?.phase !== "guessing" || round.voted || round.skipAt != null;
  $("vote-skip").hidden = round?.phase !== "guessing";
  $("vote-skip").textContent = round
    ? round.skipAt != null
      ? "Skip scheduled"
      : `${round.voted ? "Voted" : round.stage === 4 ? "Vote to reveal" : "Vote for longer clip"} · ${round.votes}/${round.votesNeeded}`
    : "Vote for longer clip";
  $("clip-status").textContent =
    round?.phase === "loading"
      ? "Finding a playable song…"
      : round
        ? `${round.phase === "revealed" ? "30-second snippet" : `${round.seconds}s clip`} · ${state.players.filter((p) => p.connected && p.ready).length}/${state.players.filter((p) => p.connected).length} ready`
        : `${state.poolCount} songs in rotation`;
  if (state.randomStart && round?.phase === "guessing" && round.offset != null)
    $("clip-status").textContent +=
      ` · Starts ${round.offset.toFixed(1)}s into the preview`;
  $("clip-status").textContent += state.playlistMode === "alternating"
    ? " · Back and forth" : " · 50/50";
  $("players").replaceChildren();
  for (const p of [...state.players].sort((a, b) => b.score - a.score)) {
    const row = document.createElement("div"),
      name = document.createElement("strong"),
      detail = document.createElement("small"),
      score = document.createElement("span");
    row.className = "room-player";
    name.textContent = `${p.name}${p.id === state.you ? " (you)" : ""}`;
    detail.textContent = [
      p.id === state.hostId ? "Host" : "Player",
      !p.connected
        ? "Disconnected"
        : p.solved
          ? "✓ Identified"
          : p.ready
            ? "Ready"
            : "Waiting",
    ].join(" · ");
    score.className = "score";
    score.textContent = p.score;
    row.append(name, detail, score);
    $("players").append(row);
  }
  const previousRound = $("room").dataset.round;
  if (previousRound !== round?.id) {
    $("room").dataset.round = round?.id || "";
    clearSuggestions();
    $("room-guess").value = "";
    $("guess-feedback").textContent = "";
    player.stop();
    playbackId = "";
    audioTask++;
    loadingRound = "";
    loadedRound = "";
    $("lobby-cover").hidden = true;
    $("lobby-cover").removeAttribute("src");
  }
  updatePersonalPlayback();
  updateCountdown();
  $("answer").hidden = round?.phase !== "revealed";
  if (round?.track) {
    $("guess-feedback").textContent = me?.solved
      ? "You identified this track."
      : "Keep listening. You'll get the next one.";
    clearSuggestions();
    const track = round.track;
    $("answer-title").textContent = track.title;
    $("answer-artist").textContent = track.artist;
    $("answer-meta").textContent = [
      track.album,
      track.year,
      track.genre !== "Unknown" ? track.genre : null,
    ]
      .filter(Boolean)
      .join(" · ");
    $("answer-sources").textContent =
      `Source: ${(track.poolSources || []).map((source) => source.name).join(" · ")}`;
    const cover = mediaCache.get(round.id)?.artworkURL || track.cover;
    if (cover) {
      if ($("lobby-cover").getAttribute("src") !== cover)
        $("lobby-cover").src = cover;
      $("lobby-cover").alt = `${track.title} artwork`;
      $("lobby-cover").hidden = false;
    }
    $("answer-links").replaceChildren();
    for (const [url, label, browser] of [
      [track.listenUrl, "Listen to song ↗", true],
      [spotifyAppURL(track.spotifyUrl), "Open in Spotify", false],
    ])
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.textContent = label;
        if (browser) {
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        }
        $("answer-links").append(a);
      }
  }
  if (playable) {
    markReady();
    void loadAudio(round);
    playScheduled();
  }
  pruneMedia([round?.id, state.upcoming?.id]);
  if (state.upcoming) warmMedia(state.upcoming);
}
function guess(candidate) {
  const title = candidate?.title || $("room-guess").value;
  if (!title.trim()) return;
  if (wasGuessedWrong(state?.wrongGuesses, candidate || { title })) {
    $("guess-feedback").textContent =
      "You already tried that song. Choose another one.";
    return;
  }
  send("guess", { title, artist: candidate?.artist });
  clearSuggestions();
  $("room-guess").value = "";
}
function renderSuggestions() {
  $("room-suggestions").replaceChildren();
  suggestionIndex = -1;
  $("room-guess").removeAttribute("aria-activedescendant");
  suggestions.forEach((song, i) => {
    const button = document.createElement("button"),
      title = document.createElement("strong"),
      artist = document.createElement("span");
    button.type = "button";
    button.id = `room-option-${i}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", "false");
    const wrong = wasGuessedWrong(state.wrongGuesses, song);
    button.disabled = wrong;
    button.classList.toggle("guessed-wrong", wrong);
    button.setAttribute("aria-disabled", String(wrong));
    title.textContent = song.title;
    artist.textContent = song.artist;
    const label = document.createElement("span");
    label.className = "suggestion-title";
    label.append(title);
    if (wrong) {
      const status = document.createElement("small");
      status.className = "guess-status";
      status.textContent = "Already guessed · incorrect";
      label.append(status);
    }
    button.append(label, artist);
    button.addEventListener("click", () => guess(song));
    $("room-suggestions").append(button);
  });
  $("room-suggestions").hidden = !suggestions.length;
  $("room-guess").setAttribute("aria-expanded", String(!!suggestions.length));
}
$("room-guess").addEventListener("input", () => {
  clearSuggestions();
  const query = $("room-guess").value.trim();
  if (!query || !state?.round) return;
  const version = searchRequest;
  searchTimer = setTimeout(async () => {
    try {
      searchController = new AbortController();
      const data = await request(
        `/api/lobbies/${code}/suggestions?${new URLSearchParams({ q: query })}`,
        {
          signal: searchController.signal,
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (version !== searchRequest || state.round?.phase !== "guessing")
        return;
      suggestions = data.tracks;
      renderSuggestions();
    } catch (e) {
      if (e.name !== "AbortError" && version === searchRequest)
        $("guess-feedback").textContent =
          "Suggestions unavailable. You can still type a title and submit.";
    }
  }, 220);
});
$("room-guess").addEventListener("keydown", (event) => {
  if (event.key === "Escape") clearSuggestions();
  if (["ArrowDown", "ArrowUp"].includes(event.key) && suggestions.length) {
    event.preventDefault();
    suggestionIndex = nextEnabledSuggestion(
      suggestions,
      suggestionIndex,
      event.key === "ArrowDown" ? 1 : -1,
      (song) => wasGuessedWrong(state.wrongGuesses, song),
    );
    [...$("room-suggestions").children].forEach((el, i) =>
      el.setAttribute("aria-selected", String(i === suggestionIndex)),
    );
    if (suggestionIndex < 0) {
      $("room-guess").removeAttribute("aria-activedescendant");
      return;
    }
    $("room-guess").setAttribute(
      "aria-activedescendant",
      `room-option-${suggestionIndex}`,
    );
  }
});
$("room-guess-form").addEventListener("submit", (event) => {
  event.preventDefault();
  guess(suggestions[suggestionIndex]);
});
$("create-room").addEventListener("click", () => enter(true));
$("join-room").addEventListener("click", () => enter(false));
for (const action of ["next", "play", "stop", "skip", "reveal"])
  $(`host-${action}`).addEventListener("click", () => send(action));
$("vote-skip").addEventListener("click", () => send("vote"));
$("play-clip").addEventListener("click", playPersonalClip);
$("enable-audio").addEventListener("click", async () => {
  try {
    await unlock();
    if (state?.round) await loadAudio(state.round);
    playScheduled();
  } catch (e) {
    error(e.message);
  }
});
$("room-volume").addEventListener("input", () =>
  player.setVolume(Number($("room-volume").value) / 100),
);
$("lobby-cover").addEventListener(
  "error",
  () => ($("lobby-cover").hidden = true),
);
$("copy-invite").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(`${location.origin}/lobby/${code}`);
    $("copy-invite").textContent = "Copied!";
    setTimeout(() => ($("copy-invite").textContent = "Copy invite"), 2000);
  } catch {
    error(`Invite link: ${location.origin}/lobby/${code}`);
  }
});
$("leave-room").addEventListener("click", () => {
  stopped = true;
  pruneMedia();
  send("leave");
  sessionStorage.removeItem(`beatguessr:room:${code}`);
  player.stop();
  location.href = "/lobby";
});
$("lobby-csv").addEventListener("change", async () => {
  const file = $("lobby-csv").files[0];
  if (!file) return;
  try {
    if (file.size > 4 * 1024 * 1024) throw new Error("CSV must be under 4 MB.");
    const result = await request("/api/playlists/import", {
      method: "POST",
      body: JSON.stringify({
        name: file.name.replace(/\.csv$/i, ""),
        csv: await file.text(),
      }),
    });
    let warning = "";
    try { await rememberPlaylist(result.playlist, request); }
    catch (e) { warning = cacheErrorMessage(e); }
    await sources([result.playlist.id]);
    error(warning);
  } catch (e) {
    error(e.message);
  } finally {
    $("lobby-csv").value = "";
  }
});
void sources().catch((e) => error(e.message));
