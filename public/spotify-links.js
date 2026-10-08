export function spotifyAppURL(value) {
  if (typeof value !== "string") return null;
  const uri = /^spotify:(track|album|playlist):([a-zA-Z0-9]{22})$/.exec(value);
  if (uri) return uri[0];
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "open.spotify.com" || url.username || url.password)
      return null;
    const resource = /^\/(?:intl-[a-z-]+\/)?(track|album|playlist)\/([a-zA-Z0-9]{22})\/?$/.exec(url.pathname);
    return resource ? `spotify:${resource[1]}:${resource[2]}` : null;
  } catch { return null; }
}
