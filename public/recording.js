const text = (value = "") => String(value).normalize("NFKD")
  .replace(/\p{M}/gu, "").toLowerCase();
const kinds = [
  ["live", /\blive\b|\ben vivo\b|\bao vivo\b|\bin concert\b/],
  ["acoustic", /\bacoustic\b|\bunplugged\b/],
  ["remix", /\bremix(?:ed)?\b/],
  ["edit", /\bedit\b/],
  ["radio", /\bradio\s+(?:edit|mix|version)\b/],
  ["single", /\bsingle\s+version\b/],
  ["album", /\balbum\s+version\b/],
  ["remaster", /\bremaster(?:ed)?\b/],
  ["mono", /\bmono\b/], ["stereo", /\bstereo\b/],
  ["demo", /\bdemo\b/], ["instrumental", /\binstrumental\b/],
  ["karaoke", /\bkaraoke\b/], ["cover", /\bcover\s+version\b/],
  ["sped", /\bsped[\s-]+up\b/], ["slowed", /\bslowed\b/],
  ["reverb", /\breverb\b/],
  ["rerecorded", /\bre[\s-]?record(?:ed|ing)\b|\btaylor'?s version\b/],
  ["extended", /\bextended\b/], ["mix", /\bmix\b/],
  ["alternate", /\balternate\b|\bouttake\b|\btake\s+\d+\b/],
  ["session", /\bsessions?\b/],
  ["orchestral", /\borchestral\b|\bsymphonic\b/],
  ["clean", /\bclean\b/], ["explicit", /\bexplicit\b/],
  ["medley", /\bmedley\b/],
];
function versionKinds(value) {
  const normalized = text(value);
  return kinds.filter(([, pattern]) => pattern.test(normalized)).map(([kind]) => kind);
}
const creditParts = (value = "") => String(value).split(/,|;|\s+&\s+|\s+(?:feat\.?|ft\.?|featuring)\s+/i)
  .map((part) => text(part).replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
function featured(song) {
  const labels = [song.title, song.artist].flatMap((value) => {
    const match = /\b(?:feat\.?|ft\.?|featuring)\s+([^\])]+)/i.exec(value || "");
    return match ? creditParts(match[1]) : [];
  });
  return [...new Set(labels)].sort();
}
function qualifiers(title = "") {
  title = String(title || "");
  const result = [...title.matchAll(/\(([^()]*)\)|\[([^\[\]]*)\]|\s+[-–—]\s+(.+)$/g)]
    .map((match) => match[1] || match[2] || match[3])
    .filter((value) => versionKinds(value).length);
  const suffix = /\s+(live(?:\s+(?:at|in|from)\s+.+)?|acoustic|instrumental|demo|remix|remastered(?:\s+\d{4})?)$/i.exec(title);
  if (suffix) result.push(suffix[1]);
  return result;
}
function albumPerformance(album = "") {
  return /(?:^live(?:$|\s+(?:at|in|from|on)\b)|\blive\s+(?:at|in|from)\b|\blive\s*$|[([]\s*live\b|\bin concert\b|\bunplugged\b|\bacoustic sessions?\b)/i.test(text(album));
}
function version(song) {
  const albumLabels = qualifiers(song.album);
  const labels = [...qualifiers(song.title), ...(song.version ? [song.version] : []), ...albumLabels];
  if (albumPerformance(song.album) && !albumLabels.length) labels.push(song.album);
  const types = [...new Set(versionKinds(labels.join(" ")))].sort();
  if (song.version && !versionKinds(song.version).length) types.push("other");
  // Event names, remixers, take numbers, and remaster years distinguish two
  // versions of the same kind. Generic markers alone do not identify them.
  const detail = text(labels.join(" "))
    .replace(/\b(?:feat\.?|ft\.?|featuring)\s.*$/i, "")
    .replace(/\b(?:live|en vivo|ao vivo|in concert|acoustic|unplugged|remix(?:ed)?|edit|radio|single|album|version|remaster(?:ed)?|mono|stereo|demo|instrumental|karaoke|cover|sped|up|slowed|reverb|re[\s-]?record(?:ed|ing)|extended|mix|alternate|outtake|take|sessions?|orchestral|symphonic|clean|explicit|medley|at|in|from|on)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return { types, details: [...new Set(detail.split(/\s+/).filter(Boolean))].sort() };
}
export function matchingTitle(title = "") {
  let value = String(title || "");
  for (const label of qualifiers(title)) {
    value = value.replace(`(${label})`, "").replace(`[${label}]`, "");
    value = value.replace(new RegExp(`\\s+[-–—]\\s+${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), "");
    if (value.endsWith(` ${label}`)) value = value.slice(0, -label.length - 1);
  }
  return text(value).replace(/\b(?:feat\.?|ft\.?|featuring)\s.*$/i, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}
export function sameVersion(seed, song) {
  const wanted = version(seed), candidate = version(song);
  if (wanted.types.join("|") !== candidate.types.join("|")) return false;
  const requestedGuests = featured(seed), candidateGuests = featured(song);
  const requestedCredits = [...creditParts(seed.artist), ...requestedGuests];
  if (candidateGuests.length && (requestedGuests.length || creditParts(seed.artist).length > 1) &&
    !candidateGuests.every((guest) => requestedCredits.includes(guest))) return false;
  if (requestedGuests.length && candidateGuests.length &&
    !requestedGuests.every((guest) => candidateGuests.includes(guest))) return false;
  return wanted.details.every((detail) => candidate.details.includes(detail));
}
export function recordingKey(song) {
  const edition = version(song);
  return `${matchingTitle(song.title)}|${edition.types.join("|")}|${edition.details.join(" ")}|${featured(song).join("|")}`;
}
export function sameArtist(first = "", second = "") {
  const key = (value) => text(value).replace(/[^\p{L}\p{N}]/gu, "");
  if (!first || !second) return false;
  if (key(first) === key(second)) return true;
  const one = creditParts(first), two = creditParts(second);
  if (one[0] !== two[0]) return false;
  if (one.length > 1 && two.length > 1)
    return one.slice(1).every((artist) => two.includes(artist)) ||
      two.slice(1).every((artist) => one.includes(artist));
  return true;
}
