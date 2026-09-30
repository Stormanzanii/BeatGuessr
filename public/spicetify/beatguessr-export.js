// Install as a Spicetify extension. Right-click a playlist -> Export for BeatGuessr.
// Reads playlist metadata only. No session tokens or audio leave Spotify.
(function beatguessrExport() {
  if (!window.Spicetify?.ContextMenu || !Spicetify.Platform?.PlaylistAPI) {
    setTimeout(beatguessrExport, 500);
    return;
  }
  const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  async function exportPlaylist(uris) {
    const uri = uris[0];
    try {
      Spicetify.showNotification("Reading playlist for BeatGuessr…");
      const api = Spicetify.Platform.PlaylistAPI;
      const metadata = await api.getMetadata(uri);
      const rows = [],
        seen = new Set(),
        pages = new Set();
      let offset = 0;
      let expectedTotal = metadata.totalLength;
      while (true) {
        const result = await api.getContents(uri, { offset, limit: 100 });
        expectedTotal = result.totalLength ?? result.total ?? expectedTotal;
        if (typeof expectedTotal === "number" && expectedTotal > 10000)
          throw new Error("Export supports up to 10,000 playlist entries.");
        const items = result.items || [];
        if (!items.length) {
          if (typeof expectedTotal === "number" && offset < expectedTotal)
            throw new Error(
              `Spotify stopped at ${offset} of ${expectedTotal} entries. Try the export again.`,
            );
          break;
        }
        if (offset + items.length > 10000)
          throw new Error("Export supports up to 10,000 playlist entries.");
        const signature = JSON.stringify(
          items.map((item) => [
            item.uid,
            (item.track || item).uri || (item.track || item).link,
          ]),
        );
        if (pages.has(signature))
          throw new Error(
            "Spotify repeated a page. Export stopped to avoid saving an incomplete playlist.",
          );
        pages.add(signature);
        for (const item of items) {
          const track = item.track || item;
          const id = track.uri || track.link;
          if (!id?.startsWith("spotify:track:") || seen.has(id)) continue;
          const title = track.name || track.title;
          const artists = track.artists || track.metadata?.artists || [];
          const artist = artists
            .map((a) =>
              typeof a === "string" ? a : a.name || a.profile?.name || "",
            )
            .filter(Boolean)
            .join(", ");
          if (!title || !artist) continue;
          const release =
            track.album?.releaseDate?.isoString ||
            track.album?.releaseDate ||
            track.album?.date?.isoString ||
            "";
          rows.push([
            title,
            artist,
            /^\d{4}/.test(String(release)) ? String(release).slice(0, 4) : "",
            "",
            id,
            `https://open.spotify.com/playlist/${uri.split(":")[2]}`,
          ]);
          seen.add(id);
        }
        offset += items.length;
        Spicetify.showNotification(
          `Reading playlist: ${offset}${typeof expectedTotal === "number" ? ` / ${expectedTotal}` : ""} entries…`,
        );
        if (typeof expectedTotal === "number" && offset >= expectedTotal) break;
      }
      if (!rows.length)
        throw new Error("No song metadata returned by this Spotify version.");
      const csv = [
        ["Title", "Artist", "Year", "Genre", "Track URI", "Playlist URL"],
        ...rows,
      ]
        .map((row) => row.map(csvCell).join(","))
        .join("\r\n");
      const url = URL.createObjectURL(
        new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(metadata.name || "Spotify playlist").replace(/[<>:"/\\|?*]/g, "-")}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      Spicetify.showNotification(
        `Exported ${rows.length} songs. Import the CSV in BeatGuessr.`,
      );
    } catch (error) {
      Spicetify.showNotification(`BeatGuessr: ${error.message}`, true);
    }
  }
  new Spicetify.ContextMenu.Item(
    "Export for BeatGuessr",
    exportPlaylist,
    (uris) =>
      uris.length === 1 && /^spotify:playlist:[a-zA-Z0-9]+$/.test(uris[0]),
    "download",
  ).register();
})();
