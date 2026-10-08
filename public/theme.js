// Visual themes. Each theme is one stylesheet in /themes/ laid over base.css.
// The inline script in each page's <head> applies the saved theme before the
// first paint, so keep its list in step with THEMES.
export const THEMES = ["spicy", "sleeve", "broadcast", "neon"];
const KEY = "beatguessr:theme";

export function savedTheme() {
  try {
    const theme = localStorage.getItem(KEY);
    return THEMES.includes(theme) ? theme : THEMES[0];
  } catch {
    return THEMES[0];
  }
}

export function applyTheme(theme) {
  if (!THEMES.includes(theme)) return;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {}
  const current = document.getElementById("theme-css");
  const href = `/themes/${theme}.css`;
  if (current.getAttribute("href") === href) return;
  // Load the new sheet beside the old one and drop the old one once it has
  // applied, so switching never flashes an unstyled page.
  const next = current.cloneNode();
  next.removeAttribute("id");
  next.href = href;
  next.addEventListener(
    "load",
    () => {
      current.remove();
      next.id = "theme-css";
    },
    { once: true },
  );
  current.after(next);
}

export function setupThemePicker(select) {
  if (!select) return;
  select.value = savedTheme();
  select.addEventListener("change", () => applyTheme(select.value));
}

// The backdrop some themes paint from album art. Only ever set from a song
// whose answer is already showing, so it never gives the current one away.
// The new cover gets its own backdrop, laid over the old one and faded in
// once the image is decoded; the old one goes only after that. Swapping the
// image on a single backdrop left a frame with nothing painted, which
// showed as the whole page blinking black.
let ambientRequest = 0;
export async function setAmbientCover(url) {
  if (!url) return;
  const request = ++ambientRequest;
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    return;
  }
  if (request !== ambientRequest) return;
  const current = document.querySelector(".ambient:not(.leaving)");
  if (!current) return;
  const next = current.cloneNode(true);
  next.style.setProperty("--ambient-cover", `url(${JSON.stringify(url)})`);
  next.classList.add("entering");
  current.after(next);
  current.classList.add("leaving");
  document.documentElement.dataset.ambient = "cover";
  // Two frames: one to paint it transparent, one to start the fade.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => next.classList.remove("entering")),
  );
  setTimeout(() => current.remove(), 1600);
}

// Playback progress as a 0-1 custom property, for themes that fill text
// along with the clip. Set only on the elements that read it: setting it on
// <body> every frame restyled the whole page and made the glass panels
// re-blur, which flickered.
export function setProgress(progress, ...elements) {
  for (const element of elements)
    element?.style.setProperty("--progress", String(progress));
}
