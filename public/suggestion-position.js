// Opens a suggestion list on whichever side of its input has more room, and
// caps its height to that room so the last option is never off-screen.
const GAP = 6;
const MARGIN = 12;
const MAX_HEIGHT = 360;
const MIN_HEIGHT = 120;

export function placeSuggestions(list, anchor) {
  if (list.hidden) return;
  const box = anchor.getBoundingClientRect();
  // A sticky header covers the top of the viewport, so space above starts below it.
  const top = document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0;
  const below = innerHeight - box.bottom - GAP - MARGIN;
  const above = box.top - top - GAP - MARGIN;
  list.style.maxHeight = "";
  const wanted = Math.min(list.scrollHeight, MAX_HEIGHT);
  const flip = below < wanted && above > below;
  list.classList.toggle("above", flip);
  const room = Math.min(MAX_HEIGHT, flip ? above : below);
  list.style.maxHeight = `${Math.max(MIN_HEIGHT, room)}px`;
}

// Keeps an open list placed while the page scrolls or resizes.
export function trackSuggestions(list, anchor) {
  const update = () => placeSuggestions(list, anchor);
  addEventListener("resize", update);
  addEventListener("scroll", update, { passive: true });
  return update;
}
