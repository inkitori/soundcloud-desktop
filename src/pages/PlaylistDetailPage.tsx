import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { usePlaylist, useTracksByIds } from "../api/queries";
import {
  IconDownload,
  IconHeart,
  IconHeartFilled,
  IconPlay,
  IconRepost,
  Spinner,
} from "../components/Icons";
import { InfiniteTrackList } from "../components/InfiniteTrackList";
import { downloadTracks } from "../lib/downloads";
import { artwork, fmtDurationMs, isStub } from "../lib/format";
import {
  toggleLikePlaylist,
  toggleRepostPlaylist,
  useAuthStore,
  useSocialStore,
} from "../lib/stores";
import { playContext } from "../player/queueStore";

export function PlaylistDetailPage() {
  const { id } = useParams();
  const playlistId = Number(id);
  const { data: playlist, isLoading, error } = usePlaylist(playlistId);
  const me = useAuthStore((s) => s.status?.me);
  const liked = useSocialStore((s) => s.likedPlaylists.has(playlistId));
  const reposted = useSocialStore((s) => s.repostedPlaylists.has(playlistId));

  // Tracks beyond the first ~5 arrive as {id} stubs; hydrate them in bulk.
  const stubIds = useMemo(
    () => (playlist?.tracks ?? []).filter(isStub).map((t) => t.id),
    [playlist],
  );
  const { data: hydrated } = useTracksByIds(stubIds);

  const tracks = useMemo(() => {
    if (!playlist) return [];
    const byId = new Map((hydrated ?? []).map((t) => [t.id, t]));
    return playlist.tracks.map((t) => byId.get(t.id) ?? t).filter((t) => !isStub(t));
  }, [playlist, hydrated]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        <Spinner size={28} />
      </div>
    );
  }
  if (error || !playlist) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Couldn't load playlist
      </div>
    );
  }

  const art = artwork(playlist.artwork_url ?? playlist.tracks[0]?.artwork_url, 500);
  const stillHydrating = stubIds.length > 0 && !hydrated;

  return (
    <InfiniteTrackList
      tracks={tracks}
      hasNextPage={false}
      isFetchingNextPage={false}
      fetchNextPage={() => {}}
      header={
        <div className="flex items-end gap-5 px-2 py-6">
          <div className="h-36 w-36 shrink-0 overflow-hidden rounded-lg bg-zinc-800 shadow-lg">
            {art && <img src={art} alt="" className="h-full w-full object-cover" />}
          </div>
          <div className="min-w-0 pb-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              {playlist.is_album ? "Album" : "Playlist"}
            </div>
            <h1 className="truncate py-1 text-2xl font-bold text-zinc-50">
              {playlist.title ?? "Untitled"}
            </h1>
            <div className="text-sm text-zinc-400">
              {playlist.user?.username} · {playlist.track_count ?? tracks.length} tracks ·{" "}
              {fmtDurationMs(playlist.duration)}
              {stillHydrating && <span className="ml-2 text-zinc-500">loading tracks…</span>}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => playContext(tracks, 0)}
                disabled={tracks.length === 0}
                className="flex items-center gap-2 rounded-full bg-orange-600 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-40"
              >
                <IconPlay size={16} /> Play all
              </button>
              <button
                onClick={() => void downloadTracks(tracks, playlist.title ?? "playlist")}
                disabled={tracks.length === 0}
                className="flex items-center gap-2 rounded-full border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
                title="Download all tracks for offline"
              >
                <IconDownload size={14} /> Download
              </button>
              {playlist.user && me && playlist.user.id !== me.id && (
                <>
                  <button
                    onClick={() => void toggleLikePlaylist(playlistId)}
                    className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold ${
                      liked
                        ? "border-orange-500/40 text-orange-500"
                        : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                    }`}
                    title={liked ? "Unlike" : "Like"}
                  >
                    {liked ? <IconHeartFilled size={14} /> : <IconHeart size={14} />}
                    {liked ? "Liked" : "Like"}
                  </button>
                  <button
                    onClick={() => void toggleRepostPlaylist(playlistId)}
                    className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold ${
                      reposted
                        ? "border-orange-500/40 text-orange-500"
                        : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
                    }`}
                    title={reposted ? "Remove repost" : "Repost"}
                  >
                    <IconRepost size={14} />
                    {reposted ? "Reposted" : "Repost"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      }
    />
  );
}
