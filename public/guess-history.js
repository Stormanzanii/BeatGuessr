export function normalizeGuess(value = "") {
  return String(value)
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
export function wasGuessedWrong(history = [], song) {
  const title = normalizeGuess(song.title),
    artist = normalizeGuess(song.artist);
  return history.some((guess) =>
    guess.artist
      ? normalizeGuess(guess.title) === title &&
        normalizeGuess(guess.artist) === artist
      : [title, normalizeGuess(`${song.artist || ""} ${song.title}`)].includes(
          normalizeGuess(guess.title),
        ),
  );
}
export function nextEnabledSuggestion(items, current, direction, isDisabled) {
  let index = current < 0 ? (direction > 0 ? -1 : 0) : current;
  for (let count = 0; count < items.length; count++) {
    index = (index + direction + items.length) % items.length;
    if (!isDisabled(items[index])) return index;
  }
  return -1;
}
