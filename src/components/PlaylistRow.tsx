import { useState } from "react";
import { Link } from "react-router-dom";
import type { Playlist, Track } from "../api/types";
import { artwork, fmtCount, isBlocked, isStub, trackTitle } from "../lib/format";
import { audioController } from "../player/audioController";
import { usePlayerStore } from "../player/playerStore";
import { playPlaylist } from "../player/playPlaylist";
import { IconList, IconPause, IconPlay, Spinner } from "./Icons";

const PREVIEW_TRACKS = 5;

/** SoundCloud-web-style stream item: cover, play button, and the first few tracks inline. */
export function PlaylistRow({ playlist }: { playlist: Playlist }) {
  const [busy, setBusy] = useState(false);
  const currentId = usePlayerStore((s) => s.track?.id);
  const playing = usePlayerStore((s) => s.status === "playing");

  const art = artwork(
    playlist.artwork_url ?? playlist.tracks[0]?.artwork_url ?? playlist.user?.avatar_url,
    200,
  );
  const preview = playlist.tracks.filter((t) => !isStub(t)).slice(0, PREVIEW_TRACKS);
  const total = playlist.track_count ?? playlist.tracks.length;
  const year = playlist.created_at?.slice(0, 4);
  const containsCurrent = currentId != null && playlist.tracks.some((t) => t.id === currentId);

  const start = (trackId?: number) => {
    // Clicking the already-active track (or the big button while this
    // playlist is loaded) just toggles pause.
    if (containsCurrent && (trackId == null || trackId === currentId)) {
      audioController.toggle();
      return;
    }
    setBusy(true);
    void playPlaylist(playlist, trackId).finally(() => setBusy(false));
  };

  return (
    <div className="rounded-lg p-3 transition-colors hover:bg-white/[0.03]">
      <div className="flex gap-4">
        <Link
          to={`/playlist/${playlist.id}`}
          className="block h-32 w-32 shrink-0 overflow-hidden rounded-md bg-zinc-800"
        >
          {art ? (
            <img src={art} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-zinc-600">
              <IconList size={32} />
            </div>
          )}
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <button
              onClick={() => start()}
              disabled={busy}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-600 text-white hover:bg-orange-500"
              title={containsCurrent && playing ? "Pause" : "Play"}
            >
              {busy ? (
                <Spinner size={16} />
              ) : containsCurrent && playing ? (
                <IconPause size={18} />
              ) : (
                <IconPlay size={18} />
              )}
            </button>
            <div className="min-w-0">
              {playlist.user && (
                <Link
                  to={`/artist/${playlist.user.id}`}
                  className="block truncate text-xs text-zinc-400 hover:text-zinc-200 hover:underline"
                >
                  {playlist.user.username}
                </Link>
              )}
              <Link
                to={`/playlist/${playlist.id}`}
                className="block truncate text-sm font-semibold text-zinc-100 hover:underline"
              >
                {playlist.title ?? "Untitled"}
              </Link>
              <div className="text-[11px] text-zinc-500">
                {playlist.is_album ? "Album" : "Playlist"}
                {year ? ` · ${year}` : ""} · {total} tracks
              </div>
            </div>
          </div>

          {preview.length > 0 && (
            <div className="mt-3">
              {preview.map((t, i) => (
                <PreviewTrack
                  key={t.id}
                  track={t}
                  index={i}
                  isCurrent={t.id === currentId}
                  isPlaying={t.id === currentId && playing}
                  onPlay={() => start(t.id)}
                />
              ))}
            </div>
          )}
          {total > preview.length && (
            <Link
              to={`/playlist/${playlist.id}`}
              className="mt-1.5 inline-block px-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200"
            >
              View all {total} tracks
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewTrack({
  track,
  index,
  isCurrent,
  isPlaying,
  onPlay,
}: {
  track: Track;
  index: number;
  isCurrent: boolean;
  isPlaying: boolean;
  onPlay: () => void;
}) {
  const blocked = isBlocked(track);
  const art = artwork(track.artwork_url ?? track.user?.avatar_url, 120);
  return (
    <button
      onClick={blocked ? undefined : onPlay}
      disabled={blocked}
      title={blocked ? "Unavailable in your region" : undefined}
      className={`group flex h-9 w-full items-center gap-2.5 rounded px-2 text-left hover:bg-white/5 ${
        blocked ? "opacity-50" : ""
      }`}
    >
      <span className="relative h-6 w-6 shrink-0 overflow-hidden rounded bg-zinc-800">
        {art && <img src={art} alt="" className="h-full w-full object-cover" loading="lazy" />}
        {!blocked && (
          <span
            className={`absolute inset-0 flex items-center justify-center bg-black/50 text-white ${
              isPlaying ? "" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            {isPlaying ? <IconPause size={12} /> : <IconPlay size={12} />}
          </span>
        )}
      </span>
      <span className="w-4 shrink-0 text-right text-xs tabular-nums text-zinc-600">
        {index + 1}
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-sm ${
          isCurrent ? "text-orange-500" : "text-zinc-200"
        }`}
      >
        {trackTitle(track)}
      </span>
      {track.playback_count != null && (
        <span className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-zinc-500">
          <IconPlay size={10} />
          {fmtCount(track.playback_count)}
        </span>
      )}
    </button>
  );
}
