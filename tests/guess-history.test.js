import test from "node:test";
import assert from "node:assert/strict";
import {
  wasGuessedWrong,
  nextEnabledSuggestion,
} from "../public/guess-history.js";

test("wrong suggestions match songs across provider IDs without blocking another artist", () => {
  const history = [{ title: "Hello", artist: "Adèle" }];
  assert.equal(
    wasGuessedWrong(history, {
      id: "different-provider",
      title: "HELLO (Remastered)",
      artist: "Adele",
    }),
    true,
  );
  assert.equal(
    wasGuessedWrong(history, { title: "Hello", artist: "Lionel Richie" }),
    false,
  );
  assert.equal(
    wasGuessedWrong([{ title: "Wrong Title" }], {
      title: "Wrong Title",
      artist: "Anyone",
    }),
    true,
  );
  assert.equal(wasGuessedWrong([], { title: "Hello", artist: "Adele" }), false);
});
test("keyboard navigation skips disabled guesses, wraps, and handles an entirely disabled list", () => {
  const disabled = (value) => !value;
  assert.equal(
    nextEnabledSuggestion([false, true, false, true], -1, 1, disabled),
    1,
  );
  assert.equal(
    nextEnabledSuggestion([false, true, false, true], -1, -1, disabled),
    3,
  );
  assert.equal(
    nextEnabledSuggestion([false, true, false, true], 3, 1, disabled),
    1,
  );
  assert.equal(nextEnabledSuggestion([false, false], -1, 1, disabled), -1);
});
