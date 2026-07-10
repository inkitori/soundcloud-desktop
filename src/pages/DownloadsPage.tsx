import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/commands";
import type { CachedRow, Track } from "../api/types";
import { IconDownload, IconPlay, IconRadio } from "../components/Icons";
import { InfiniteTrackList } from "../components/InfiniteTrackList";
import { fmtBytes } from "../lib/format";
import { refreshDownloads, useDownloadStore, useNetworkStore } from "../lib/stores";
import { playContext } from "../player/queueStore";

type SortKey = "recent" | "played" | "title" | "artist";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Recently added" },
  { key: "played", label: "Recently played" },
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
];

/** Build a minimal Track the player/list can consume from a cached row. Cached
 * playback resolves to the local file, so no media/track_authorization needed;
 * artwork points at the locally-cached jpg when we have it (works offline). */
function rowToTrack(row: CachedRow): Track {
  const localArt = row.art_path ? convertFileSrc(row.art_path) : null;
  return {
    id: row.track_id,
    title: row.title ?? `Track ${row.track_id}`,
    duration: row.duration_ms ?? null,
    artwork_url: localArt ?? row.artwork_url ?? null,
    user: row.artist ? { id: row.artist_id ?? 0, username: row.artist } : null,
  };
}

function sortRows(rows: CachedRow[], key: SortKey): CachedRow[] {
  const out = [...rows];
  switch (key) {
    case "recent":
      return out.sort((a, b) => b.downloaded_at - a.downloaded_at);
    case "played":
      return out.sort((a, b) => b.last_played_at - a.last_played_at);
    case "title":
      return out.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
    case "artist":
      return out.sort((a, b) => (a.artist ?? "").localeCompare(b.artist ?? ""));
  }
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function DownloadsPage() {
  const cachedMap = useDownloadStore((s) => s.cached);
  const online = useNetworkStore((s) => s.online);
  const [sort, setSort] = useState<SortKey>("recent");

  // Re-sync from disk on entry so the list is fresh after downloads/removals.
  // When online, backfill artist ids / cover art for older downloads (one-time,
  // idempotent) so artist links work and offline OS art is available.
  useEffect(() => {
    void refreshDownloads();
    if (navigator.onLine) {
      void api
        .backfillDownloads()
        .then((touched) => {
          if (touched > 0) void refreshDownloads();
        })
        .catch(() => {});
    }
  }, []);

  const rows = useMemo(() => Object.values(cachedMap), [cachedMap]);
  const tracks = useMemo(() => sortRows(rows, sort).map(rowToTrack), [rows, sort]);
  const totalBytes = useMemo(() => rows.reduce((sum, r) => sum + r.bytes, 0), [rows]);

  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-zinc-500">
        <IconDownload size={40} className="text-zinc-600" />
        <p className="text-sm">No downloads yet</p>
        <p className="max-w-xs text-xs text-zinc-600">
          {online
            ? "Hit the download icon on any track — or “Download all” on a playlist — to keep it available offline."
            : "You're offline and have no downloaded tracks yet. Reconnect to download music for offline listening."}
        </p>
      </div>
    );
  }

  return (
    <InfiniteTrackList
      contextTo="/downloads"
      tracks={tracks}
      hasNextPage={false}
      isFetchingNextPage={false}
      fetchNextPage={() => {}}
      header={
        <div className="px-2 py-5">
          <h1 className="text-2xl font-bold text-zinc-50">Downloads</h1>
          <div className="mt-1 text-sm text-zinc-400">
            {rows.length} track{rows.length === 1 ? "" : "s"} · {fmtBytes(totalBytes)} on disk
            {!online && <span className="ml-2 text-orange-400">· offline</span>}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => playContext(tracks, 0, undefined, "/downloads")}
              className="flex items-center gap-2 rounded-full bg-orange-600 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-500"
            >
              <IconPlay size={16} /> Play all
            </button>
            <button
              onClick={() => playContext(shuffle(tracks), 0, undefined, "/downloads")}
              className="flex items-center gap-2 rounded-full border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 hover:border-zinc-500"
            >
              <IconRadio size={14} /> Shuffle
            </button>
            <div className="ml-auto flex items-center gap-1 rounded-full bg-zinc-900 p-1">
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSort(s.key)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    sort === s.key
                      ? "bg-white/10 text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      }
    />
  );
}
