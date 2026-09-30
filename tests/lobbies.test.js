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
test("skip voting counts one vote per unsolved player and requires a majority", async () => {
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
  assert.equal(room.round.stage, 1);
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

test("existing votes take effect when a correct guess reduces the voting majority", async () => {
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
  assert.equal(room.round.stage, 1);
  assert.equal(room.round.votes.size, 0);
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
