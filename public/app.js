import { ClipPlayer, CLIP_LENGTHS } from "./audio.js";
import { celebrate, confettiMultiplier } from "./confetti.js";
import { mergeSuggestions } from "./guess-search.js";

const $ = (id) => document.getElementById(id);
const year = new Date().getFullYear();
const readStored = (key, fallback) => {
  try {
    return (
      JSON.parse(
        localStorage.getItem(key) ??
          localStorage.getItem(key.replace(/^beatguessr:/, "beatgussr:")),
      ) ?? fallback
    );
  } catch {
    return fallback;
  }
};
const persist = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};
const settings = readStored("beatguessr:settings", {});
const state = {
  pool: [],
  playlists: [],
  local: [],
  track: null,
  stage: 0,
  done: false,
  won: false,
  selectedSources: Array.isArray(settings.sources)
    ? settings.sources
    : [settings.source].filter(Boolean),
  loading: true,
  round: 0,
  request: 0,
  played: readStored("beatguessr:played", []).slice(0, 2000),
  stats: { solved: 0, streak: 0, best: null },
  recent: [],
  wrong: [],
  suggestionIndex: -1,
};

const player = new ClipPlayer(
  (progress) => {
    $("audio-progress").style.width = `${progress * 100}%`;
  },
  (playing) => {
    $("record")?.classList.toggle("spinning", playing);
    $("play-icon").textContent = playing ? "Ⅱ" : "▶";
    if (!state.loading) $("play-text").textContent = playbackLabel(playing);
  },
);
// Useful for inspecting actual audio scheduling in browser devtools.
window.beatguessr = { state, player };

async function api(path, options) {
  const response = await fetch(
    path,
    options && {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}
function message(text, kind = "") {
  $("message").textContent = text;
  $("message").className = `message ${kind}`;
}
function playbackLabel(playing = player.playing) {
  if (playing) return state.won ? "Stop snippet" : "Listening…";
  if (state.won) {
    const seconds = Math.round(Math.min(30, player.buffer.duration) * 10) / 10;
    return `Replay ${seconds}s snippet`;
  }
  return `Play ${CLIP_LENGTHS[state.stage]}s clip`;
}
function saveSettings() {
  persist("beatguessr:settings", {
    sources: state.selectedSources.filter((id) => id !== "local"),
    genre: $("genre").value,
    from: $("year-from").value,
    to: $("year-to").value,
    volume: $("volume").value,
    randomStart: $("random-start").checked,
    autoPlay: $("auto-play").checked,
    confettiMultiplier: Number($("confetti-amount").value),
  });
}
function setLoading(loading) {
  state.loading = loading;
  $("play-button").disabled = loading || !state.track;
  $("skip-button").disabled = loading || state.done || !state.track;
  $("guess").disabled = loading || state.done || !state.track;
  $("guess-button").disabled = loading || state.done || !state.track;
  $("give-up").disabled = loading || state.done || !state.track;
  $("play-text").textContent = loading ? "Loading song…" : playbackLabel();
}
function setStage(index) {
  player.stop();
  state.stage = index;
  document.querySelectorAll("[data-stage]").forEach((button, i) => {
    button.classList.toggle("active", i === index);
    button.classList.toggle("heard", i < index);
    button.setAttribute("aria-pressed", String(i === index));
  });
  $("play-text").textContent = `Play ${CLIP_LENGTHS[index]}s clip`;
  $("skip-button").innerHTML =
    index === 4 ? "Reveal <span>↗</span>" : "Skip <span>↗</span>";
}
function updateStats() {
  $("stat-solved").textContent = state.stats.solved;
  $("stat-streak").textContent = state.stats.streak;
  $("stat-best").textContent =
    state.stats.best == null ? "—" : `${state.stats.best}s`;
}
function updateRecent() {
  const list = $("recent-tracks");
  list.replaceChildren();
  for (const song of state.recent.slice(0, 5)) {
    const row = document.createElement("div");
    row.className = "recent-track";
    const icon = document.createElement("span");
    icon.className = song.won ? "recent-icon won" : "recent-icon";
    icon.textContent = song.won ? "✓" : "↗";
    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = song.title;
    const artist = document.createElement("span");
    artist.textContent = song.artist;
    info.append(title, artist);
    const time = document.createElement("small");
    time.textContent = song.won ? `${song.seconds}s` : "revealed";
    row.append(icon, info, time);
    list.append(row);
  }
}
function showReveal(won) {
  if (state.done || !state.track) return;
  state.done = true;
  state.won = won;
  player.stop();
  clearSuggestions();
  const song = state.track,
    seconds = CLIP_LENGTHS[state.stage];
  if (won) {
    state.stats.solved++;
    state.stats.streak++;
    state.stats.best =
      state.stats.best == null ? seconds : Math.min(state.stats.best, seconds);
  } else state.stats.streak = 0;
  state.recent.unshift({ ...song, won, seconds });
  updateStats();
  updateRecent();
  setLoading(false);
  $("reveal").hidden = false;
  $("reveal-result").textContent = won
    ? `IDENTIFIED IN ${seconds}s`
    : "MEET THE TRACK";
  $("reveal-title").textContent = song.title;
  $("reveal-artist").textContent =
    `${song.artist}${song.year ? ` · ${song.year}` : ""}`;
  const sources = song.poolSources || [];
  $("reveal-source").textContent = sources.length
    ? `${sources.length > 1 ? "Sources" : "Source"}: ${sources.map((source) => source.name).join(" · ")}`
    : "";
  $("reveal-source").hidden = !sources.length;
  $("reveal-cover").hidden = !song.cover;
  if (song.cover) $("reveal-cover").src = song.cover;
  $("reveal-links").replaceChildren();
  for (const [href, label] of [
    [song.listenUrl, `Listen on ${song.source} ↗`],
    [song.spotifyUrl, "Open in Spotify ↗"],
  ]) {
    if (!href) continue;
    const link = document.createElement("a");
    link.href = href;
    link.textContent = label;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    $("reveal-links").append(link);
  }
  message(
    won ? "Correct. You got it!" : "Answer revealed.",
    won ? "success" : "",
  );
  $("reveal").classList.toggle("won", won);
  if (won) celebrate(Number($("confetti-amount").value));
  $("record-scene").classList.add("revealed");
  $("listen-caption").textContent = won
    ? "Some songs just stay with you."
    : "Now that sounds familiar.";
  if (won) void play();
}

async function newRound() {
  const request = ++state.request;
  player.stop();
  state.track = null;
  state.done = false;
  state.won = false;
  state.wrong = [];
  $("reveal").hidden = true;
  $("guess-history").replaceChildren();
  $("guess").value = "";
  clearSuggestions();
  $("record-scene").classList.remove("revealed");
  $("listen-caption").textContent = "How little do you need to hear?";
  setStage(0);
  setLoading(true);
  if (!state.pool.length) {
    setLoading(false);
    return message(
      state.selectedSources.length
        ? "No songs match these filters. Try a wider year range or another genre."
        : "Choose a playlist, import a CSV, or add local audio to start playing.",
      "error",
    );
  }
  message("Loading a song…");
  const unseen = state.pool.filter((t) => !state.played.includes(t.id));
  const candidates = [...(unseen.length ? unseen : state.pool)];
  // Shuffle once, then try distinct songs if a provider has no matching preview.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  let lastError;
  for (const seed of candidates.slice(0, 8)) {
    if (request !== state.request) return;
    try {
      let track, buffer;
      if (seed.origin === "local") {
        track = { ...seed, source: "Local file" };
        buffer = await player.decode(await seed.file.arrayBuffer());
      } else {
        ({ track } = await api("/api/resolve", {
          method: "POST",
          body: JSON.stringify({ id: seed.id }),
        }));
        try {
          buffer = await loadPreview(track);
        } catch {
          ({ track } = await api("/api/resolve", {
            method: "POST",
            body: JSON.stringify({ id: seed.id, failedSource: track.source }),
          }));
          buffer = await loadPreview(track);
        }
      }
      if (request !== state.request) return;
      player.setBuffer(buffer, $("random-start").checked);
      state.track = { ...track, poolSources: seed.poolSources || [] };
      state.round++;
      state.played = [
        seed.id,
        ...state.played.filter((id) => id !== seed.id),
      ].slice(0, 2000);
      persist("beatguessr:played", state.played);
      $("round-number").textContent =
        `ROUND ${String(state.round).padStart(2, "0")}`;
      $("audio-source").textContent =
        seed.origin === "local"
          ? "LOCAL AUDIO · ACTUAL INTRO"
          : `${track.source.toUpperCase()} · PREVIEW EXCERPT`;
      setLoading(false);
      message("Ready when you are. Press play.");
      return;
    } catch (error) {
      lastError = error;
    }
  }
  if (request !== state.request) return;
  setLoading(false);
  message(
    lastError?.message || "No playable previews found. Try another collection.",
    "error",
  );
}
async function loadPreview(track) {
  const response = await fetch(`/api/audio/${encodeURIComponent(track.id)}`);
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "Could not load audio.");
  }
  return player.decode(await response.arrayBuffer());
}
function populateGenres(genres, selected = "All") {
  $("genre").replaceChildren(
    ...["All", ...genres.filter((g) => g !== "All")].map((genre) => {
      const option = new Option(genre === "All" ? "All genres" : genre, genre);
      return option;
    }),
  );
  $("genre").value =
    genres.includes(selected) || selected === "All" ? selected : "All";
}
function sourceOptions() {
  return [
    ...state.playlists,
    { id: "local", name: "Local audio", count: state.local.length },
  ];
}
function updateSourceLabel() {
  const selected = sourceOptions().filter((s) =>
    state.selectedSources.includes(s.id),
  );
  $("source-button").textContent =
    selected.length === 1
      ? `${selected[0].name} ▾`
      : `${selected.length} sources selected ▾`;
}
async function refreshSources(selected = state.selectedSources) {
  const data = await api("/api/playlists");
  state.playlists = data.playlists;
  const options = sourceOptions();
  state.selectedSources = (
    Array.isArray(selected) ? selected : [selected]
  ).filter((id) => options.some((s) => s.id === id));
  $("source-dropdown").replaceChildren();
  for (const source of options) {
    const label = document.createElement("label");
    label.className = "source-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = source.id;
    checkbox.checked = state.selectedSources.includes(source.id);
    checkbox.dataset.source = source.id;
    checkbox.addEventListener("change", () => {
      state.selectedSources = [
        ...$("source-dropdown").querySelectorAll("input:checked"),
      ].map((input) => input.value);
      updateSourceLabel();
      $("pool-count").textContent = "Apply to update song pool";
    });
    const name = document.createElement("span");
    name.textContent = source.name;
    const count = document.createElement("small");
    count.textContent = `${source.count} songs`;
    label.append(checkbox, name, count);
    $("source-dropdown").append(label);
  }
  $("playlist-management").replaceChildren();
  for (const playlist of state.playlists) {
    const row = document.createElement("div");
    row.className = "playlist-row";
    const name = document.createElement("span");
    name.textContent = playlist.name;
    const remove = document.createElement("button");
    remove.className = "text-button danger";
    remove.textContent = "Remove";
    remove.dataset.remove = playlist.id;
    remove.addEventListener("click", async () => {
      try {
        await api(`/api/playlists/${encodeURIComponent(playlist.id)}`, {
          method: "DELETE",
        });
        await refreshSources();
        await applyFilters();
      } catch (error) {
        message(error.message, "error");
      }
    });
    row.append(name, remove);
    $("playlist-management").append(row);
  }
  updateSourceLabel();
}
async function applyFilters() {
  const from = Number($("year-from").value),
    to = Number($("year-to").value);
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 1960 ||
    to > 2100 ||
    from > to
  ) {
    return message(
      "Choose a valid year range from 1960 to 2100, with the earlier year first.",
      "error",
    );
  }
  const token = ++state.request;
  player.stop();
  setLoading(true);
  try {
    const genre = $("genre").value;
    const sources = state.selectedSources.filter((id) => id !== "local");
    const data = await api(
      `/api/catalog?${new URLSearchParams({ sources: sources.join(","), genre, from, to })}`,
    );
    if (token !== state.request) return;
    const local = state.selectedSources.includes("local")
      ? state.local.filter(
          (t) =>
            (genre === "All" || t.genre === genre) &&
            (t.year == null
              ? from <= 1960 && to >= year
              : t.year >= from && t.year <= to),
        )
      : [];
    const combined = new Map();
    for (const song of [...data.tracks, ...local]) {
      const key = `${cleanTitle(song.title)}|${cleanTitle(song.artist)}`;
      const previous = combined.get(key);
      combined.set(key, {
        ...song,
        poolSources: [
          ...new Map(
            [...(previous?.poolSources || []), ...(song.poolSources || [])].map(
              (source) => [source.id, source],
            ),
          ).values(),
        ],
      });
    }
    state.pool = [...combined.values()];
    populateGenres(
      [
        ...new Set([
          ...data.genres,
          ...(state.selectedSources.includes("local") ? ["Unknown"] : []),
        ]),
      ],
      genre,
    );
    $("source-detail").textContent =
      `${state.selectedSources.length} source${state.selectedSources.length === 1 ? "" : "s"} combined. Duplicate songs count once.${data.duplicatesRemoved ? ` ${data.duplicatesRemoved} duplicates removed.` : ""}`;
    if (
      state.playlists.some(
        (playlist) =>
          state.selectedSources.includes(playlist.id) &&
          playlist.possiblyTruncated,
      )
    ) {
      $("source-detail").textContent +=
        " A Spotify import may contain only its first 100 songs. Import a full CSV to include the rest.";
    }
    if (token !== state.request) return;
    $("pool-count").textContent = `${state.pool.length} songs in rotation`;
    if ($("collection-summary"))
      $("collection-summary").textContent =
        `${state.pool.length} songs · ${genre === "All" ? "All genres" : genre} · ${from === 1960 && to === year ? "All years" : `${from}–${to}`}`;
    $("source-dropdown").hidden = true;
    $("source-button").setAttribute("aria-expanded", "false");
    saveSettings();
    await newRound();
  } catch (error) {
    if (token === state.request) {
      state.track = null;
      setLoading(false);
      message(error.message, "error");
    }
  }
}
async function changeSource() {
  $("year-from").value = 1960;
  $("year-to").value = year;
  $("genre").value = "All";
  updateDecades();
  await applyFilters();
}
function updateDecades() {
  document.querySelectorAll("[data-decade]").forEach((button) => {
    const decade = button.dataset.decade;
    button.classList.toggle(
      "selected",
      decade === "all"
        ? $("year-from").value === "1960" && Number($("year-to").value) === year
        : Number($("year-from").value) === Number(decade) &&
            Number($("year-to").value) === Math.min(Number(decade) + 9, year),
    );
  });
}
function cleanTitle(value) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s*\((feat\.?|ft\.?|with)\b[^)]*\)/gi, "")
    .replace(
      /\s*[-(]\s*(remaster(ed)?|radio edit|single version|album version|deluxe).*$/i,
      "",
    )
    .replace(/[^\p{L}\p{N}]/gu, "");
}
function submitGuess(title, candidate) {
  if (state.loading || state.done || !state.track || !title.trim()) return;
  const target = cleanTitle(state.track.title),
    guess = cleanTitle(title);
  const correct = candidate
    ? candidate.id === state.track.seedId ||
      candidate.id === state.track.id ||
      ([target, cleanTitle(state.track.matchedTitle || "")].includes(
        cleanTitle(candidate.title),
      ) &&
        [state.track.artist, state.track.matchedArtist]
          .filter(Boolean)
          .some(
            (artist) => cleanTitle(candidate.artist) === cleanTitle(artist),
          ))
    : [
        target,
        cleanTitle(state.track.matchedTitle || ""),
        cleanTitle(`${state.track.artist} ${state.track.title}`),
      ]
        .filter(Boolean)
        .includes(guess);
  clearSuggestions();
  $("guess").value = "";
  if (correct) return showReveal(true);
  state.wrong.push(title);
  const entry = document.createElement("span");
  entry.textContent = `× ${title}`;
  $("guess-history").append(entry);
  message("Not that one. Try a little more audio.");
  advance();
}
async function play() {
  if (state.loading || !state.track) return;
  if (player.playing) return player.stop();
  try {
    if (state.won) {
      // Shift a late random start back so the reward can use the full 30 seconds.
      const offset = Math.min(
        player.offset,
        Math.max(0, player.buffer.duration - 30),
      );
      await player.play(30, { offset });
    } else await player.play(CLIP_LENGTHS[state.stage]);
  } catch (error) {
    message(error.message, "error");
  }
}
function advance() {
  if (state.loading || state.done || !state.track) return;
  if (state.stage === 4) return showReveal(false);
  setStage(state.stage + 1);
  if ($("auto-play").checked) void play();
}
let suggestions = [];
let suggestionRequest = 0,
  suggestionTimer,
  suggestionController;
function clearSuggestions() {
  suggestionRequest++;
  clearTimeout(suggestionTimer);
  suggestionController?.abort();
  suggestions = [];
  state.suggestionIndex = -1;
  $("suggestions").replaceChildren();
  $("suggestions").hidden = true;
  $("guess").setAttribute("aria-expanded", "false");
  $("guess").removeAttribute("aria-activedescendant");
}
function suggestionStatus(text) {
  const status = document.createElement("div");
  status.className = "suggestion-status";
  status.setAttribute("role", "status");
  status.textContent = text;
  $("suggestions").replaceChildren(status);
  $("suggestions").hidden = false;
  $("guess").setAttribute("aria-expanded", "true");
}
function searchSuggestions() {
  clearSuggestions();
  const query = $("guess").value.trim();
  if (!query || state.loading || state.done) return;
  const exact = state.pool.filter(
    (song) => cleanTitle(query) && cleanTitle(song.title) === cleanTitle(query),
  );
  if (exact.length) {
    suggestions = mergeSuggestions(exact, [], query);
    renderSuggestions();
  }
  if (query.length < 2) return;
  const request = suggestionRequest;
  suggestionTimer = setTimeout(async () => {
    if (!suggestions.length) suggestionStatus("Searching songs…");
    suggestionController = new AbortController();
    try {
      const data = await api(
        `/api/search?${new URLSearchParams({ q: query.slice(0, 120) })}`,
        { signal: suggestionController.signal },
      );
      if (request !== suggestionRequest || state.done || state.loading) return;
      suggestions = mergeSuggestions(state.pool, data.tracks, query);
      if (!suggestions.length)
        return suggestionStatus(
          "No matches. You can still type a title and press Enter.",
        );
      renderSuggestions();
    } catch (error) {
      if (request !== suggestionRequest || error.name === "AbortError") return;
      suggestions = mergeSuggestions(state.pool, [], query);
      if (suggestions.length) return renderSuggestions();
      suggestionStatus("Search is unavailable. Type a title and press Enter.");
    }
  }, 220);
}
function renderSuggestions() {
  state.suggestionIndex = -1;
  $("suggestions").replaceChildren();
  $("suggestions").hidden = !suggestions.length;
  $("guess").setAttribute("aria-expanded", String(!!suggestions.length));
  $("guess").removeAttribute("aria-activedescendant");
  suggestions.forEach((song, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.id = `suggestion-${index}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", "false");
    const title = document.createElement("strong");
    title.textContent = song.title;
    const artist = document.createElement("span");
    artist.textContent = song.artist;
    button.append(title, artist);
    button.addEventListener("click", () => submitGuess(song.title, song));
    $("suggestions").append(button);
  });
}
$("guess").addEventListener("input", searchSuggestions);
$("guess").addEventListener("keydown", (event) => {
  if (["ArrowDown", "ArrowUp"].includes(event.key) && suggestions.length) {
    event.preventDefault();
    state.suggestionIndex =
      (state.suggestionIndex +
        (event.key === "ArrowDown" ? 1 : -1) +
        suggestions.length) %
      suggestions.length;
    [...$("suggestions").children].forEach((el, index) =>
      el.setAttribute("aria-selected", String(index === state.suggestionIndex)),
    );
    $("guess").setAttribute(
      "aria-activedescendant",
      `suggestion-${state.suggestionIndex}`,
    );
  }
  if (event.key === "Escape") {
    clearSuggestions();
  }
});
$("guess-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const candidate =
    !$("suggestions").hidden && state.suggestionIndex >= 0
      ? suggestions[state.suggestionIndex]
      : null;
  submitGuess(candidate?.title || $("guess").value, candidate);
});
$("play-button").addEventListener("click", play);
$("skip-button").addEventListener("click", advance);
$("give-up").addEventListener("click", () => showReveal(false));
$("reroll").addEventListener("click", newRound);
$("next-button").addEventListener("click", newRound);
$("apply-filters").addEventListener("click", applyFilters);
$("source-button").addEventListener("click", () => {
  $("source-dropdown").hidden = !$("source-dropdown").hidden;
  $("source-button").setAttribute(
    "aria-expanded",
    String(!$("source-dropdown").hidden),
  );
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".source-picker")) {
    $("source-dropdown").hidden = true;
    $("source-button").setAttribute("aria-expanded", "false");
  }
});
document.querySelectorAll("[data-stage]").forEach((button) =>
  button.addEventListener("click", () => {
    if (!state.track || state.loading || state.done) return;
    setStage(Number(button.dataset.stage));
  }),
);
document.querySelectorAll("[data-decade]").forEach((button) =>
  button.addEventListener("click", () => {
    const decade = button.dataset.decade;
    $("year-from").value = decade === "all" ? 1960 : decade;
    $("year-to").value =
      decade === "all" ? year : Math.min(Number(decade) + 9, year);
    updateDecades();
  }),
);
for (const id of ["year-from", "year-to"])
  $(id).addEventListener("input", updateDecades);
$("volume").addEventListener("input", () => {
  player.setVolume(Number($("volume").value) / 100);
  $("volume-value").textContent = `${$("volume").value}%`;
  saveSettings();
});
$("random-start").addEventListener("change", () => {
  if (player.buffer) player.setStart($("random-start").checked);
  saveSettings();
});
$("auto-play").addEventListener("change", saveSettings);
function updateConfettiSetting() {
  const multiplier = confettiMultiplier($("confetti-amount").value);
  $("confetti-amount").value = multiplier;
  $("confetti-value").textContent = `${multiplier}×`;
  $("confetti-amount").setAttribute("aria-valuetext", `${multiplier} times`);
}
$("confetti-amount").addEventListener("input", () => {
  updateConfettiSetting();
  saveSettings();
});
$("help-button").addEventListener("click", () => $("help-dialog").showModal());
$("import-button").addEventListener("click", () => {
  $("import-message").textContent = "";
  $("import-dialog").showModal();
});
document
  .querySelectorAll("[data-close]")
  .forEach((button) =>
    button.addEventListener("click", () => $(button.dataset.close).close()),
  );
document.querySelectorAll("dialog").forEach((dialog) =>
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dialog.close();
    }
  }),
);

async function importPlaylist(input) {
  $("playlist-import-submit").disabled = true;
  $("csv-file").disabled = true;
  $("import-message").textContent = "Importing playlist…";
  try {
    const { playlist } = await api("/api/playlists/import", {
      method: "POST",
      body: JSON.stringify(input),
    });
    const existing = state.selectedSources.filter((id) => id !== "curated");
    await refreshSources([...new Set([...existing, playlist.id])]);
    $("import-dialog").close();
    await changeSource();
  } catch (error) {
    $("import-message").textContent = error.message;
  } finally {
    $("playlist-import-submit").disabled = false;
    $("csv-file").disabled = false;
  }
}
$("playlist-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void importPlaylist({ url: $("playlist-url").value });
});
$("csv-file").addEventListener("change", async () => {
  const file = $("csv-file").files[0];
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) {
    $("import-message").textContent = "Choose a CSV under 4 MB.";
    return;
  }
  await importPlaylist({
    csv: await file.text(),
    name: file.name.replace(/\.csv$/i, ""),
  });
  $("csv-file").value = "";
});
$("local-files").addEventListener("change", async () => {
  for (const file of $("local-files").files) {
    if (file.size > 100 * 1024 * 1024) {
      message("Local audio files must be under 100 MB each.", "error");
      continue;
    }
    const name = file.name.replace(/\.[^.]+$/, "");
    const separator = name.indexOf(" - ");
    const artist =
      separator >= 0 ? name.slice(0, separator) : "Local collection";
    const title = separator >= 0 ? name.slice(separator + 3) : name;
    state.local.push({
      id: `local:${crypto.randomUUID()}`,
      title,
      artist,
      year: null,
      genre: "Unknown",
      origin: "local",
      poolSources: [{ id: "local", name: "Local audio" }],
      file,
    });
  }
  await refreshSources([
    ...new Set([
      ...state.selectedSources.filter((id) => id !== "curated"),
      "local",
    ]),
  ]);
  await changeSource();
  $("local-files").value = "";
});
document.addEventListener("keydown", (event) => {
  if (
    event.target.closest("input, select, textarea, button") ||
    document.querySelector("dialog[open]")
  )
    return;
  if (event.code === "Space") {
    event.preventDefault();
    void play();
  }
  if (event.key.toLowerCase() === "n" && state.done) void newRound();
});

async function init() {
  $("year-from").value = settings.from || 1960;
  $("year-to").value = settings.to || year;
  $("volume").value = settings.volume ?? 60;
  $("volume-value").textContent = `${$("volume").value}%`;
  player.setVolume(Number($("volume").value) / 100);
  $("random-start").checked = settings.randomStart ?? false;
  $("auto-play").checked = settings.autoPlay ?? true;
  $("confetti-amount").value = confettiMultiplier(
    settings.confettiMultiplier ?? 6,
  );
  updateConfettiSetting();
  try {
    await refreshSources();
    const data = await api(
      `/api/catalog?sources=${encodeURIComponent(state.selectedSources.filter((id) => id !== "local").join(","))}`,
    );
    populateGenres(data.genres, settings.genre || "All");
    updateDecades();
    await applyFilters();
  } catch (error) {
    setLoading(false);
    message(`Could not load the app: ${error.message}`, "error");
  }
}
void init();
