import test from "node:test";
import assert from "node:assert/strict";
import { LobbyHub } from "../server/lobbies.js";
import { createAccess } from "../server/access.js";

const pool = [
  {
    id: "seed",
    title: "Test Song",
    artist: "Test Artist",
    poolSources: [{ id: "mix", name: "Our mix" }],
  },
];
function setup(options) {
  const hub = new LobbyHub(
    async (seed) => ({
      track: { ...seed, cover: "https://example.com/art.jpg" },
      audio: { bytes: Buffer.from("audio"), type: "audio/mpeg" },
    }),
    options,
  );
  const { room, player: host } = hub.create("Host", pool, "owner");
  const players = [
    host,
    ...["One", "Two", "Three"].map((name) => hub.join(room.code, name)),
  ];
  for (const player of players) hub.connect(room, player, () => {});
  return { hub, room, host, players };
}
test("only the host can load songs or control playback", async () => {
  const { hub, room, host, players } = setup();
  await assert.rejects(
    hub.command(room, players[1], { type: "next" }),
    /Only the host/,
  );
  await hub.command(room, host, { type: "next" });
  const roundId = room.round.id;
  for (const type of ["play", "stop", "skip", "reveal"])
    await assert.rejects(
      hub.command(room, players[1], { type, roundId }),
      /Only the host/,
    );
  await assert.rejects(
    hub.command(room, host, { type: "play", roundId }),
    /everyone to load/,
  );
  for (const player of players)
    await hub.command(room, player, { type: "ready", roundId });
  await hub.command(room, host, { type: "play", roundId });
  assert.equal(room.round.playback.seconds, 0.1);
  assert.ok(room.round.playback.startsAt > Date.now());
});
test("guesses and scoring stay server-side; answers appear only after everyone solves", async () => {
  const { hub, room, host, players } = setup();
  await hub.command(room, host, { type: "next" });
  const roundId = room.round.id;
  const hidden = JSON.stringify(hub.snapshot(room, players[1]));
  assert.ok(!hidden.includes("Test Song"));
  assert.ok(!hidden.includes("art.jpg"));
  assert.ok(!hidden.includes(host.token));
  for (const player of players) {
    await hub.command(room, player, {
      type: "guess",
      roundId,
      title: "Test Song",
      artist: "Test Artist",
    });
    assert.equal(player.score, 100);
    await assert.rejects(
      hub.command(room, player, { type: "guess", roundId, title: "Test Song" }),
      /already|finished/,
    );
  }
  assert.equal(room.round.phase, "revealed");
  assert.equal(room.round.playback.seconds, 30);
  assert.equal(
    hub.snapshot(room, host).round.track.poolSources[0].name,
    "Our mix",
  );
});
test("all connected players must vote before one 30-second countdown starts", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { hub, room, host, players } = setup();
  await hub.next(room);
  const roundId = room.round.id;
  await hub.command(room, players[1], { type: "vote", roundId });
  await hub.command(room, players[1], { type: "vote", roundId });
  assert.equal(room.round.votes.size, 1);
  assert.equal(room.round.stage, 0);
  await hub.command(room, players[2], { type: "vote", roundId });
  assert.equal(room.round.stage, 0);
  await hub.command(room, host, { type: "vote", roundId });
  assert.equal(room.round.stage, 0);
  assert.equal(room.round.skipAt, null, "Three of four votes is not enough");
  await hub.command(room, players[3], { type: "vote", roundId });
  const deadline = room.round.skipAt;
  assert.equal(deadline, Date.now() + 30000);
  t.mock.timers.tick(1000);
  await hub.command(room, players[1], { type: "vote", roundId });
  assert.equal(
    room.round.skipAt,
    deadline,
    "Repeated votes cannot restart the timer",
  );
  t.mock.timers.tick(28999);
  assert.equal(room.round.stage, 0);
  t.mock.timers.tick(1);
  assert.equal(room.round.stage, 1);
  assert.equal(room.round.skipAt, null);
  assert.equal(room.round.votes.size, 0);
  assert.equal(room.round.playback.seconds, 0.5);
  await assert.rejects(
    hub.command(room, players[1], { type: "vote", roundId: "old-round" }),
    /round changed/,
  );
});
test("reconnecting keeps identity and score; leaving transfers the host", async () => {
  const { hub, room, host, players } = setup();
  host.score = 80;
  hub.disconnect(room, host);
  assert.equal(hub.join(room.code, "Host", host.token), host);
  assert.equal(host.score, 80);
  hub.connect(room, host, () => {});
  hub.leave(room, host);
  assert.equal(room.hostId, players[1].id);
  assert.throws(() => hub.authorize(room.code, host.token), /Join the lobby/);
});

test("solved players still vote and reconnecting preserves the countdown", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { hub, room, host, players } = setup();
  await hub.next(room);
  const roundId = room.round.id;
  await hub.command(room, host, { type: "vote", roundId });
  await hub.command(room, players[1], { type: "vote", roundId });
  assert.equal(room.round.stage, 0);
  await hub.command(room, players[3], {
    type: "guess",
    roundId,
    title: "Test Song",
  });
  assert.equal(room.round.stage, 0);
  assert.equal(room.round.skipAt, null);
  await hub.command(room, players[2], { type: "vote", roundId });
  assert.equal(room.round.skipAt, null);
  await hub.command(room, players[3], { type: "vote", roundId });
  assert.equal(room.round.skipAt, Date.now() + 30000);
  const deadline = room.round.skipAt;
  t.mock.timers.tick(5000);
  hub.disconnect(room, players[2]);
  hub.connect(room, players[2], () => {});
  assert.equal(hub.snapshot(room, players[2]).round.skipAt, deadline);
  t.mock.timers.tick(25000);
  assert.equal(room.round.stage, 1);
  assert.equal(room.round.votes.size, 0);
});

test("disconnected players do not hold up voting, and empty rooms cancel timers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { hub, room, players } = setup();
  await hub.next(room);
  for (const player of players.slice(0, 3))
    await hub.command(room, player, { type: "vote", roundId: room.round.id });
  assert.equal(room.round.skipAt, null);
  hub.disconnect(room, players[3]);
  assert.equal(room.round.skipAt, Date.now() + 30000);
  for (const player of players.slice(0, 3)) hub.disconnect(room, player);
  assert.equal(room.round.skipAt, null);
  t.mock.timers.tick(30000);
  assert.equal(room.round.stage, 0);
});

test("countdowns reveal the final clip and cannot affect a later round", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { hub, room, host, players } = setup();
  await hub.next(room);
  room.round.stage = 4;
  for (const player of players)
    await hub.command(room, player, { type: "vote", roundId: room.round.id });
  assert.equal(room.round.phase, "guessing");
  t.mock.timers.tick(30000);
  assert.equal(room.round.phase, "revealed");
  assert.equal(room.round.playback.seconds, 30);
  await hub.next(room);
  for (const player of players)
    await hub.command(room, player, { type: "vote", roundId: room.round.id });
  await hub.command(room, host, { type: "reveal", roundId: room.round.id });
  await hub.next(room);
  t.mock.timers.tick(30000);
  assert.equal(room.round.stage, 0);
  assert.equal(room.round.phase, "guessing");
  assert.equal(room.round.skipAt, null);
});

test("host skips and everyone solving cancel pending countdowns", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { hub, room, host, players } = setup();
  await hub.next(room);
  for (const player of players)
    await hub.command(room, player, { type: "vote", roundId: room.round.id });
  await hub.command(room, host, { type: "skip", roundId: room.round.id });
  t.mock.timers.tick(30000);
  assert.equal(room.round.stage, 1);
  for (const player of players)
    await hub.command(room, player, { type: "vote", roundId: room.round.id });
  for (const player of players)
    await hub.command(room, player, {
      type: "guess",
      roundId: room.round.id,
      title: "Test Song",
    });
  assert.equal(room.round.skipAt, null);
  t.mock.timers.tick(30000);
  assert.equal(room.round.phase, "revealed");
  assert.equal(room.round.stage, 1);
});
test("host disconnect transfers controls after the reconnect grace period", async () => {
  const { hub, room, host, players } = setup({ hostGrace: 5 });
  hub.disconnect(room, host);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(room.hostId, players[1].id);
});
test("public sessions use signed cookies and restrict cross-origin commands", () => {
  const access = createAccess({
    origin: "https://beatguessr.clypdat.xyz",
    secret: "test-secret",
  });
  let cookie;
  const owner = access.visitor(
    { headers: {} },
    { setHeader: (_, value) => (cookie = value) },
  );
  assert.ok(cookie.includes("HttpOnly"));
  assert.ok(cookie.includes("Secure"));
  assert.equal(
    access.visitor({ headers: { cookie } }, { setHeader() {} }),
    owner,
  );
  assert.notEqual(
    access.visitor(
      { headers: { cookie: cookie.replace(owner, "0".repeat(32)) } },
      { setHeader() {} },
    ),
    owner,
  );
  assert.equal(access.allowsOrigin("https://beatguessr.clypdat.xyz"), true);
  assert.equal(access.allowsOrigin("https://other.example"), false);
});

test("starting a round consumes the prepared song while another warms in the background", async () => {
  let release;
  let calls = 0;
  const hub = new LobbyHub(async (seed) => {
    if (++calls > 1)
      await new Promise((resolve) => {
        release = resolve;
      });
    return {
      track: seed,
      audio: { bytes: Buffer.from("prepared"), type: "audio/mpeg" },
    };
  });
  const { room } = hub.create("Host", pool, "owner");
  const prepared = room.preload;
  await prepared.task;
  await hub.next(room);
  assert.equal(room.round.id, prepared.id);
  assert.equal(room.round.audio, prepared.asset.audio);
  assert.equal(room.round.phase, "guessing");
  assert.equal(calls, 2);
  release();
  await room.preload.task;
});

test("lobby preloading balances unequal playlists even after the smaller one is exhausted", async () => {
  const balancedPool = [
    ...Array.from({ length: 2 }, (_, index) => ({
      id: `small-${index}`, poolSources: [{ id: "small", name: "Small mix" }],
    })),
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `large-${index}`, poolSources: [{ id: "large", name: "Large mix" }],
    })),
  ];
  const hub = new LobbyHub(async (seed) => ({ track: seed }), { random: () => 0 });
  const { room, player } = hub.create("Host", balancedPool, "owner", { balancePlaylists: true });
  assert.equal(hub.snapshot(room, player).balancePlaylists, true);
  let previous;
  for (let round = 0; round < 6; round++) {
    await hub.next(room);
    assert.equal(room.round.track.poolSources[0].id, "small");
    assert.notEqual(room.round.seedId, previous);
    previous = room.round.seedId;
  }
  const normal = hub.create("Normal host", balancedPool, "normal-owner").room;
  assert.equal(normal.balancePlaylists, false);
});

test("balanced lobbies try another playlist if the chosen source has no usable preview", async () => {
  const failed = Array.from({ length: 12 }, (_, index) => ({
    id: `failed-${index}`, poolSources: [{ id: "failed" }],
  }));
  const playable = { id: "playable", poolSources: [{ id: "playable" }] };
  let attempts = 0;
  const hub = new LobbyHub(async (seed) => {
    attempts++;
    if (seed !== playable) throw new Error("No preview");
    return { track: seed };
  }, { random: () => 0 });
  const { room } = hub.create("Host", [...failed, playable], "owner", { balancePlaylists: true });
  await room.preload.task;
  assert.equal(room.preload.asset.seedId, "playable");
  assert.equal(attempts, 2);
});

test("only the host's decoded audio sets a room's shared random point", async () => {
  const { hub, room, host, players } = setup();
  room.randomStart = true;
  await hub.next(room);
  const roundId = room.round.id;
  await hub.command(room, players[1], {
    type: "ready",
    roundId,
    duration: 900,
  });
  assert.equal(room.round.offset, null);
  await hub.command(room, host, { type: "ready", roundId, duration: 30 });
  const offset = room.round.offset;
  assert.ok(offset > 0 && offset <= 15);
  for (const player of players.slice(1))
    await hub.command(room, player, { type: "ready", roundId, duration: 1 });
  assert.equal(room.round.offset, offset);
  await hub.command(room, host, { type: "play", roundId });
  assert.equal(room.round.playback.offset, offset);
  await hub.command(room, host, { type: "skip", roundId });
  assert.equal(room.round.playback.offset, offset);
});

test("the host shares its waveform-checked start and later ready messages cannot move it", async () => {
  const { hub, room, host, players } = setup();
  await hub.next(room);
  const roundId = room.round.id;
  await hub.command(room, players[1], {
    type: "ready",
    roundId,
    duration: 30,
    startOffset: 8,
  });
  assert.equal(room.round.timingReady, false);
  await hub.command(room, host, {
    type: "ready",
    roundId,
    duration: 30,
    startOffset: 2,
  });
  assert.equal(room.round.offset, 2);
  assert.equal(room.round.timingReady, true);
  await hub.command(room, host, {
    type: "ready",
    roundId,
    duration: 30,
    startOffset: 5,
  });
  assert.equal(room.round.offset, 2);
  hub.leave(room, host);
  assert.equal(room.round.offset, 2);
});

test("wrong guesses are private, reject repeats, survive reconnects, and reset each round", async () => {
  const { hub, room, host, players } = setup();
  await hub.next(room);
  const guess = {
    type: "guess",
    roundId: room.round.id,
    title: "Wrong Song",
    artist: "Wrong Artist",
  };
  await hub.command(room, players[1], guess);
  assert.equal(hub.snapshot(room, players[1]).wrongGuesses.length, 1);
  assert.deepEqual(hub.snapshot(room, host).wrongGuesses, []);
  await assert.rejects(hub.command(room, players[1], guess), /already tried/);
  await hub.command(room, players[2], guess);
  hub.disconnect(room, players[1]);
  hub.connect(room, players[1], () => {});
  assert.equal(hub.snapshot(room, players[1]).wrongGuesses.length, 1);
  hub.reveal(room);
  await hub.next(room);
  assert.deepEqual(hub.snapshot(room, players[1]).wrongGuesses, []);
});
