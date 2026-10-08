import test from "node:test";
import assert from "node:assert/strict";
import { spotifyAppURL } from "../public/spotify-links.js";

const id = "1234567890123456789012";
test("Spotify links open native app URIs and discard web-only query parameters", () => {
  for (const kind of ["track", "album", "playlist"]) {
    assert.equal(spotifyAppURL(`https://open.spotify.com/${kind}/${id}?si=share`), `spotify:${kind}:${id}`);
    assert.equal(spotifyAppURL(`https://open.spotify.com/intl-en/${kind}/${id}`), `spotify:${kind}:${id}`);
    assert.equal(spotifyAppURL(`spotify:${kind}:${id}`), `spotify:${kind}:${id}`);
  }
});
test("malformed and unrelated URLs cannot become external app links", () => {
  for (const value of [null, "", `https://example.com/track/${id}`, `https://open.spotify.com.evil.test/track/${id}`,
    `https://user:password@open.spotify.com/track/${id}`, "spotify:track:short", "javascript:alert(1)"])
    assert.equal(spotifyAppURL(value), null);
});
