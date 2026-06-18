import { Link } from "react-router-dom";
import { api } from "../api/commands";
import type { Track } from "../api/types";
import {
  fmtDurationMs,
  isBlocked,
  isSnipped,
  trackArt,
  trackArtist,
  trackTitle,
} from "../lib/format";
import { startDownload } from "../lib/downloads";
import { openAddToPlaylist } from "../lib/modals";
import {
  refreshDownloads,
  toggleLikeTrack,
  toggleRepostTrack,
  useDownloadStore,
  useLikedStore,
  useSocialStore,
} from "../lib/stores";
import { showToast } from "../lib/toast";
import { usePlayerStore } from "../player/playerStore";
import { addLast } from "../player/queueStore";
import {
  IconCheck,
  IconDownload,
  IconHeart,
  IconHeartFilled,
  IconPause,
  IconPlay,
  IconPlaylistAdd,
  IconPlus,
  IconRepost,
  Spinner,
} from "./Icons";

interface TrackRowProps {
  track: Track;
  onPlay: () => void;
  /**
   * Override "is this the playing row". Lists where the same track can appear
   * more than once (the feed) pass this so only the clicked row highlights;
   * everywhere else it falls back to matching the playing track's id.
   */
  isCurrent?: boolean;
}

export function TrackRow({ track, onPlay, isCurrent: isCurrentOverride }: TrackRowProps) {
  const idCurrent = usePlayerStore((s) => s.track?.id === track.id);
  const playing = usePlayerStore((s) => s.status === "playing");
  const isCurrent = isCurrentOverride ?? idCurrent;
  const isPlaying = isCurrent && playing;
  const liked = useLikedStore((s) => s.ids.has(track.id));
  const reposted = useSocialStore((s) => s.repostedTracks.has(track.id));
  const cached = useDownloadStore((s) => track.id in s.cached);
  const progress = useDownloadStore((s) => s.progress[track.id]);

  const blocked = isBlocked(track);
  const art = trackArt(track, 120);

  return (
    <div
      className={`group flex h-14 items-center gap-3 rounded-md px-2 hover:bg-white/5 ${
        isCurrent ? "bg-white/5" : ""
      } ${blocked ? "opacity-50" : ""}`}
      onDoubleClick={blocked ? undefined : onPlay}
    >
      <button
        onClick={blocked ? undefined : onPlay}
        className="relative h-10 w-10 shrink-0 overflow-hidden rounded bg-zinc-800"
        title={blocked ? "Unavailable in your region" : "Play"}
      >
        {art ? (
          <img src={art} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-orange-900 to-zinc-800" />
        )}
        {!blocked && (
          <span
            className={`absolute inset-0 flex items-center justify-center bg-black/50 text-white ${
              isPlaying ? "" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            {isPlaying ? <IconPause size={16} /> : <IconPlay size={16} />}
          </span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-sm font-medium ${
            isCurrent ? "text-orange-500" : "text-zinc-100"
          }`}
        >
          {trackTitle(track)}
        </div>
        <div className="truncate text-xs text-zinc-400">
          {track.user?.id ? (
            <Link to={`/artist/${track.user.id}`} className="hover:text-zinc-200 hover:underline">
              {trackArtist(track)}
            </Link>
          ) : (
            trackArtist(track)
          )}
        </div>
      </div>

      {isSnipped(track) && (
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
          Preview
        </span>
      )}
      {blocked && (
        <span className="rounded bg-zinc-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
          Unavailable
        </span>
      )}

      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => void toggleLikeTrack(track)}
          className={`rounded p-1.5 hover:bg-white/10 ${liked ? "text-orange-500 opacity-100" : "text-zinc-400"}`}
          title={liked ? "Unlike" : "Like"}
        >
          {liked ? <IconHeartFilled size={15} /> : <IconHeart size={15} />}
        </button>
        <button
          onClick={() => void toggleRepostTrack(track.id)}
          className={`rounded p-1.5 hover:bg-white/10 ${
            reposted ? "text-orange-500 opacity-100" : "text-zinc-400"
          }`}
          title={reposted ? "Remove repost" : "Repost"}
        >
          <IconRepost size={15} />
        </button>
        <button
          onClick={() => {
            addLast(track);
            showToast(`Added "${trackTitle(track)}" to queue`);
          }}
          className="rounded p-1.5 text-zinc-400 hover:bg-white/10"
          title="Add to queue"
        >
          <IconPlus size={15} />
        </button>
        <button
          onClick={() => openAddToPlaylist(track)}
          className="rounded p-1.5 text-zinc-400 hover:bg-white/10"
          title="Add to playlist"
        >
          <IconPlaylistAdd size={15} />
        </button>
        <DownloadButton trackId={track.id} cached={cached} progress={progress} blocked={blocked} />
      </div>
      {/* Persistent status (hidden while the hover actions are showing). */}
      {progress != null ? (
        <span
          className="tabular-nums text-[10px] text-zinc-400 group-hover:hidden"
          title="Downloading…"
        >
          {Math.round(progress * 100)}%
        </span>
      ) : cached ? (
        <span className="text-emerald-400 group-hover:hidden" title="Downloaded for offline">
          <IconCheck size={14} />
        </span>
      ) : null}
      {liked && (
        <span className="text-orange-500 group-hover:hidden">
          <IconHeartFilled size={13} />
        </span>
      )}

      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-zinc-500">
        {fmtDurationMs(track.duration)}
      </span>
    </div>
  );
}

function DownloadButton({
  trackId,
  cached,
  progress,
  blocked,
}: {
  trackId: number;
  cached: boolean;
  progress: number | undefined;
  blocked: boolean;
}) {
  if (progress != null) {
    return (
      <span className="flex items-center gap-1 p-1.5 text-xs tabular-nums text-zinc-400">
        <Spinner size={13} />
        {Math.round(progress * 100)}%
      </span>
    );
  }
  if (cached) {
    return (
      <button
        onClick={() => {
          void api.removeDownload(trackId).then(() => refreshDownloads());
        }}
        className="rounded p-1.5 text-emerald-400 hover:bg-white/10"
        title="Downloaded — click to remove"
      >
        <IconCheck size={15} />
      </button>
    );
  }
  return (
    <button
      onClick={blocked ? undefined : () => startDownload(trackId)}
      className="rounded p-1.5 text-zinc-400 hover:bg-white/10"
      title="Download for offline"
    >
      <IconDownload size={15} />
    </button>
  );
}
