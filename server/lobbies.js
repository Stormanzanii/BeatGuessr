import { randomBytes, randomUUID } from "node:crypto";
import { normalize } from "./matching.js";
import { randomClipStart } from "../public/clip-start.js";
import { wasGuessedWrong } from "../public/guess-history.js";
import { songCandidates } from "../public/song-selection.js";

const lengths = [0.1, 0.5, 2, 8, 15];
const fail = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  throw error;
};
export class LobbyHub {
  constructor(
    loadTrack,
    { now = Date.now, hostGrace = 30000, random = Math.random } = {},
  ) {
    this.rooms = new Map();
    this.loadTrack = loadTrack;
    this.now = now;
    this.hostGrace = hostGrace;
    this.random = random;
  }
  create(
    name,
    pool,
    owner,
    { randomStart = false, balancePlaylists = false } = {},
  ) {
    this.prune();
    if (!pool.length) fail("Select at least one imported playlist with songs.");
    if (
      this.rooms.size >= 50 ||
      [...this.rooms.values()].filter((room) => room.owner === owner).length >=
        3
    )
      fail("Too many active rooms. Leave an existing room first.");
    let code;
    do {
      code = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
    } while (this.rooms.has(code));
    const room = {
      code,
      owner,
      randomStart: randomStart === true,
      balancePlaylists: balancePlaylists === true,
      pool,
      players: new Map(),
      round: null,
      roundNumber: 0,
      used: new Set(),
      updated: this.now(),
      message: "Waiting for the host to start.",
    };
    this.rooms.set(code, room);
    let player;
    try {
      player = this.join(code, name);
    } catch (error) {
      this.rooms.delete(code);
      throw error;
    }
    room.hostId = player.id;
    this.preload(room);
    return { room, player };
  }
  get(code) {
    const room = this.rooms.get(String(code).toUpperCase());
    if (!room)
      fail("Lobby not found or expired. Ask the host for a new invite.", 404);
    return room;
  }
  join(code, name, token) {
    const room = this.get(code);
    if (token) {
      const player = [...room.players.values()].find((p) => p.token === token);
      if (!player) fail("Your session expired. Join again with a nickname.");
      return player;
    }
    name = typeof name === "string" ? name.trim().slice(0, 24) : "";
    if (!name) fail("Enter a nickname.");
    if (room.players.size >= 16) fail("This room is full (16 players).");
    if (
      [...room.players.values()].some(
        (p) => p.name.toLowerCase() === name.toLowerCase(),
      )
    )
      fail("That nickname is already taken in this room.");
    const player = {
      id: randomUUID(),
      token: randomBytes(32).toString("hex"),
      name,
      score: 0,
      connected: false,
      ready: false,
      lastGuess: -Infinity,
      disconnectedAt: this.now(),
    };
    room.players.set(player.id, player);
    room.updated = this.now();
    return player;
  }
  authorize(code, token) {
    const room = this.get(code);
    const player = [...room.players.values()].find((p) => p.token === token);
    if (!player) fail("Join the lobby to continue.", 403);
    return { room, player };
  }
  connect(room, player, send) {
    player.connected = true;
    player.send = send;
    player.disconnectedAt = null;
    const host = room.players.get(room.hostId);
    if (
      host &&
      !host.connected &&
      this.now() - host.disconnectedAt >= this.hostGrace
    )
      this.transferHost(room);
    room.updated = this.now();
    this.broadcast(room);
  }
  disconnect(room, player) {
    player.connected = false;
    player.ready = false;
    player.send = null;
    player.disconnectedAt = this.now();
    room.round?.votes.delete(player.id);
    const timer = setTimeout(() => {
      if (!player.connected && room.hostId === player.id)
        this.transferHost(room);
    }, this.hostGrace);
    timer.unref?.();
    this.settleVotes(room);
    this.broadcast(room);
  }
  leave(room, player) {
    player.send = null;
    room.players.delete(player.id);
    room.round?.votes.delete(player.id);
    if (room.hostId === player.id) this.transferHost(room);
    if (!room.players.size) {
      this.cancelSkip(room);
      this.rooms.delete(room.code);
    } else {
      this.settleVotes(room);
      this.broadcast(room);
    }
  }
  transferHost(room) {
    const next = [...room.players.values()].find((p) => p.connected);
    if (next) {
      room.hostId = next.id;
      if (room.round && next.duration)
        this.setTiming(room, next.duration, next.startOffset);
      room.message = `${next.name} is now the host.`;
    }
    this.broadcast(room);
  }
  snapshot(room, player) {
    const round = room.round;
    const voters = [...room.players.values()].filter((p) => p.connected);
    return {
      code: room.code,
      you: player.id,
      hostId: room.hostId,
      message: room.message,
      serverNow: this.now(),
      poolCount: room.pool.length,
      randomStart: room.randomStart,
      balancePlaylists: room.balancePlaylists,
      wrongGuesses: round?.wrong.get(player.id) || [],
      players: [...room.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        connected: p.connected,
        ready: p.ready,
        solved: round?.solved.has(p.id) || false,
      })),
      round: round
        ? {
            id: round.id,
            number: room.roundNumber,
            phase: round.phase,
            stage: round.stage,
            seconds:
              Math.round(
                Math.min(
                  lengths[round.stage],
                  Math.max(
                    0,
                    (round.duration ?? Infinity) - (round.offset || 0),
                  ),
                ) * 1000,
              ) / 1000,
            offset: round.offset,
            timingReady: !!round.timingReady,
            artwork: !!round.track?.cover,
            playback: round.playback,
            votes: round.votes.size,
            votesNeeded: Math.max(1, voters.length),
            voted: round.votes.has(player.id),
            skipAt: round.skipAt ?? null,
            track:
              round.phase === "revealed"
                ? {
                    title: round.track.title,
                    artist: round.track.artist,
                    album: round.track.album,
                    year: round.track.year,
                    genre: round.track.genre,
                    cover: round.track.cover,
                    poolSources: round.track.poolSources,
                    listenUrl: round.track.listenUrl,
                    spotifyUrl: round.track.spotifyUrl,
                  }
                : null,
          }
        : null,
      upcoming: room.preload?.asset
        ? { id: room.preload.id, artwork: !!room.preload.asset.track.cover }
        : null,
    };
  }
  broadcast(room) {
    for (const player of room.players.values())
      if (player.connected)
        player.send?.({ type: "state", state: this.snapshot(room, player) });
  }
  play(room, seconds, continueFromPrevious = false) {
    const round = room.round;
    round.playback = {
      id: randomUUID(),
      startsAt: this.now() + 1000,
      seconds,
      continueFromPrevious,
      offset:
        seconds === 30
          ? Math.min(
              round.offset || 0,
              Math.max(0, (round.duration || 30) - 30),
            )
          : round.offset || 0,
    };
  }
  setTiming(room, duration, startOffset) {
    room.round.duration = duration;
    if (
      !room.round.timingReady &&
      Number.isFinite(startOffset) &&
      startOffset >= 0 &&
      startOffset <= Math.max(0, duration - 0.1)
    )
      room.round.offset = startOffset;
    else if (room.round.offset === null)
      room.round.offset = room.randomStart ? randomClipStart(duration) : 0;
    else
      room.round.offset = Math.min(
        room.round.offset,
        Math.max(0, duration - 0.1),
      );
    room.round.timingReady = true;
  }
  reveal(room) {
    if (!room.round || room.round.phase !== "guessing") return;
    this.cancelSkip(room);
    room.round.phase = "revealed";
    room.round.votes.clear();
    this.play(room, 30);
    room.message = "Round complete. Enjoy the track!";
  }
  skip(room) {
    if (room.randomStart && room.round.offset === null) return;
    this.cancelSkip(room);
    if (room.round.stage === 4) this.reveal(room);
    else {
      room.round.stage++;
      room.round.votes.clear();
      this.play(room, lengths[room.round.stage], true);
      room.message = "A longer clip is ready.";
    }
  }
  settleVotes(room) {
    if (room.round?.phase !== "guessing") return;
    const active = [...room.players.values()].filter(
      (player) => player.connected,
    );
    if (!active.length) {
      this.cancelSkip(room);
      return;
    }
    const unsolved = active.filter(
      (player) => !room.round.solved.has(player.id),
    );
    if (!unsolved.length) this.reveal(room);
    else if (room.round.votes.size >= active.length)
      this.startSkipCountdown(room);
  }
  cancelSkip(room) {
    if (!room.round) return;
    clearTimeout(room.round.skipTimer);
    room.round.skipTimer = null;
    room.round.skipAt = null;
  }
  startSkipCountdown(room) {
    const round = room.round;
    if (round.skipAt != null || (room.randomStart && round.offset === null))
      return;
    round.skipAt = this.now() + 30000;
    const stage = round.stage;
    round.skipTimer = setTimeout(() => {
      if (
        this.rooms.get(room.code) !== room ||
        room.round !== round ||
        round.phase !== "guessing" ||
        round.stage !== stage
      )
        return;
      this.skip(room);
      this.broadcast(room);
    }, 30000);
    round.skipTimer.unref?.();
  }
  preload(room) {
    if (room.preload) return room.preload;
    const queued = { id: randomUUID(), asset: null, task: null };
    room.preload = queued;
    if (
      !room.balancePlaylists &&
      room.pool.every((song) => room.used.has(song.id))
    ) {
      room.used.clear();
    }
    const candidates = songCandidates(room.pool, {
      played: room.used,
      lastPlayed: room.round?.seedId,
      balancePlaylists: room.balancePlaylists,
      random: this.random,
    });
    queued.task = (async () => {
      for (const seed of candidates.slice(0, 8)) {
        if (!this.rooms.has(room.code)) return null;
        try {
          const loaded = await this.loadTrack(seed);
          queued.asset = {
            ...loaded,
            track: { ...loaded.track, poolSources: seed.poolSources },
            seedId: seed.id,
          };
          if (room.preload === queued && this.rooms.has(room.code))
            this.broadcast(room);
          return queued.asset;
        } catch {
          /* Try another playable song without blocking the current round. */
        }
      }
      return null;
    })();
    return queued;
  }
  async next(room) {
    this.cancelSkip(room);
    const queued = this.preload(room);
    room.preload = null;
    const round = {
      id: queued.id,
      phase: "loading",
      stage: 0,
      votes: new Set(),
      solved: new Set(),
      wrong: new Map(),
      playback: null,
      skipAt: null,
      skipTimer: null,
      track: null,
      audio: null,
      offset: room.randomStart ? null : 0,
      timingReady: false,
    };
    room.round = round;
    room.roundNumber++;
    room.message = "Loading the next song…";
    for (const player of room.players.values()) {
      player.ready = false;
      player.duration = null;
      player.startOffset = null;
      player.lastGuess = -Infinity;
    }
    this.broadcast(room);
    const loaded = await queued.task;
    if (loaded) {
      if (room.round !== round || !this.rooms.has(room.code)) return;
      Object.assign(round, loaded);
      round.phase = "guessing";
      room.used.add(loaded.seedId);
      room.message =
        "Audio is loading. Each player can replay the current clip.";
      this.broadcast(room);
      this.preload(room);
      return;
    }
    if (room.round === round) {
      room.round = null;
      room.message =
        "No playable previews found. Try again or create a room with another playlist.";
      this.broadcast(room);
    }
  }
  async command(room, player, action) {
    room.updated = this.now();
    if (action.type === "ping") {
      player.send?.({ type: "pong", sent: action.sent, serverNow: this.now() });
      return;
    }
    if (action.type === "leave") {
      this.leave(room, player);
      return;
    }
    if (
      ["next", "play", "stop", "skip", "reveal"].includes(action.type) &&
      player.id !== room.hostId
    )
      fail("Only the host can control playback or start a round.", 403);
    if (action.type === "next") {
      if (room.round?.phase === "loading") fail("A song is already loading.");
      if (room.round?.phase === "guessing")
        fail("Finish or reveal this round before starting another.");
      return this.next(room);
    }
    const round = room.round;
    if (!round || action.roundId !== round.id)
      fail("The round changed. Try again.");
    if (action.type === "ready") {
      player.ready = true;
      if (
        Number.isFinite(action.duration) &&
        action.duration > 0 &&
        action.duration <= 900
      ) {
        player.duration = action.duration;
        player.startOffset = action.startOffset;
        if (player.id === room.hostId)
          this.setTiming(room, action.duration, action.startOffset);
      }
      if (
        round.phase === "guessing" &&
        [...room.players.values()]
          .filter((p) => p.connected)
          .every((p) => p.ready)
      )
        room.message = "Everyone's ready. Name that track.";
      this.settleVotes(room);
      this.broadcast(room);
      return;
    }
    if (round.phase === "loading") fail("The song is still loading.");
    if (action.type === "play") {
      if (room.randomStart && round.offset === null)
        fail("Wait for the host's audio to finish loading.");
      if ([...room.players.values()].some((p) => p.connected && !p.ready))
        fail("Wait for everyone to load the audio.");
      this.play(room, round.phase === "revealed" ? 30 : lengths[round.stage]);
    } else if (action.type === "stop")
      round.playback = { id: randomUUID(), stopped: true };
    else if (action.type === "reveal") this.reveal(room);
    else if (round.phase !== "guessing") fail("This round is finished.");
    else if (action.type === "skip") this.skip(room);
    else if (action.type === "vote") {
      round.votes.add(player.id);
    } else if (action.type === "guess") {
      if (round.solved.has(player.id))
        fail("You already identified this song.");
      const text =
        typeof action.title === "string"
          ? action.title.trim().slice(0, 300)
          : "";
      if (!text) fail("Enter a song title.");
      const guess = {
        title: text,
        artist:
          typeof action.artist === "string"
            ? action.artist.slice(0, 300)
            : undefined,
      };
      const wrong = round.wrong.get(player.id) || [];
      if (wasGuessedWrong(wrong, guess))
        fail("You already tried that song. Choose another one.");
      if (wrong.length >= 200)
        fail(
          "Guess limit reached for this round. Vote to skip or wait for the reveal.",
        );
      if (this.now() - player.lastGuess < 600)
        fail("Wait a moment before guessing again.");
      player.lastGuess = this.now();
      const titles = [
        round.track.title,
        round.track.matchedTitle,
        `${round.track.artist} ${round.track.title}`,
      ]
        .filter(Boolean)
        .map(normalize);
      const correct =
        titles.includes(normalize(text)) &&
        (!action.artist ||
          [round.track.artist, round.track.matchedArtist]
            .filter(Boolean)
            .map(normalize)
            .includes(normalize(String(action.artist))));
      if (correct) {
        round.solved.add(player.id);
        player.score += [100, 80, 60, 40, 20][round.stage];
      } else round.wrong.set(player.id, [...wrong, guess]);
      player.send?.({
        type: "guess-result",
        correct,
        message: correct
          ? "Correct! Your points are locked in. Let the others guess."
          : "Not that one. Try another title.",
      });
      const active = [...room.players.values()].filter((p) => p.connected);
      if (active.length && active.every((p) => round.solved.has(p.id)))
        this.reveal(room);
    } else fail("Unknown lobby action.");
    this.settleVotes(room);
    this.broadcast(room);
  }
  prune() {
    for (const [code, room] of this.rooms)
      if (this.now() - room.updated > 2 * 60 * 60 * 1000) {
        this.cancelSkip(room);
        for (const player of room.players.values())
          player.send?.({
            type: "error",
            message: "This room expired. Create a new lobby.",
          });
        this.rooms.delete(code);
      }
  }
}
