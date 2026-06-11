import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  useUser,
  useUserLikes,
  useUserPlaylists,
  useUserToptracks,
  useUserTracks,
} from "../api/queries";
import { Spinner } from "../components/Icons";
import { InfiniteTrackList } from "../components/InfiniteTrackList";
import { PlaylistCard } from "../components/PlaylistCard";
import { artwork, fmtCount } from "../lib/format";

type Tab = "popular" | "tracks" | "likes" | "playlists";

export function ArtistPage() {
  const { id } = useParams();
  const userId = Number(id);
  const { data: user, isLoading } = useUser(userId);
  const [tab, setTab] = useState<Tab>("popular");

  if (isLoading || !user) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        <Spinner size={28} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-6 pt-6">
        <div className="flex items-center gap-4">
          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full bg-zinc-800">
            {user.avatar_url && (
              <img
                src={artwork(user.avatar_url, 200)!}
                alt=""
                className="h-full w-full object-cover"
              />
            )}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold text-zinc-50">
              {user.username}
              {user.verified && <span className="ml-2 text-sm text-sky-400">✓</span>}
            </h1>
            <div className="text-sm text-zinc-400">
              {fmtCount(user.followers_count)} followers · {fmtCount(user.track_count)} tracks
              {user.city ? ` · ${user.city}` : ""}
            </div>
          </div>
        </div>
        <div className="flex gap-1 py-3">
          {(["popular", "tracks", "likes", "playlists"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold capitalize ${
                tab === t
                  ? "bg-zinc-100 text-zinc-900"
                  : "bg-white/5 text-zinc-300 hover:bg-white/10"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {tab === "popular" && <UserTrackTab userId={userId} kind="popular" />}
        {tab === "tracks" && <UserTrackTab userId={userId} kind="tracks" />}
        {tab === "likes" && <UserLikesTab userId={userId} />}
        {tab === "playlists" && <UserPlaylistsTab userId={userId} />}
      </div>
    </div>
  );
}

function UserTrackTab({ userId, kind }: { userId: number; kind: "popular" | "tracks" }) {
  const top = useUserToptracks(userId);
  const all = useUserTracks(userId);
  const q = kind === "popular" ? top : all;
  const tracks = useMemo(() => q.data?.pages.flatMap((p) => p.collection) ?? [], [q.data]);
  if (q.isLoading) return <Loading />;
  return (
    <InfiniteTrackList
      tracks={tracks}
      hasNextPage={!!q.hasNextPage}
      isFetchingNextPage={q.isFetchingNextPage}
      fetchNextPage={() => void q.fetchNextPage()}
    />
  );
}

function UserLikesTab({ userId }: { userId: number }) {
  const q = useUserLikes(userId);
  const tracks = useMemo(
    () =>
      q.data?.pages.flatMap((p) => p.collection.flatMap((i) => (i.track ? [i.track] : []))) ?? [],
    [q.data],
  );
  if (q.isLoading) return <Loading />;
  return (
    <InfiniteTrackList
      tracks={tracks}
      hasNextPage={!!q.hasNextPage}
      isFetchingNextPage={q.isFetchingNextPage}
      fetchNextPage={() => void q.fetchNextPage()}
    />
  );
}

function UserPlaylistsTab({ userId }: { userId: number }) {
  const q = useUserPlaylists(userId);
  const playlists = useMemo(() => q.data?.pages.flatMap((p) => p.collection) ?? [], [q.data]);
  if (q.isLoading) return <Loading />;
  return (
    <div className="h-full overflow-y-auto px-4 pb-4">
      <div className="flex flex-wrap gap-2">
        {playlists.map((p) => (
          <PlaylistCard key={p.id} playlist={p} />
        ))}
      </div>
      {q.hasNextPage && (
        <button
          onClick={() => void q.fetchNextPage()}
          className="mx-auto my-4 block rounded-full bg-white/5 px-4 py-1.5 text-xs text-zinc-300 hover:bg-white/10"
        >
          Load more
        </button>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex h-full items-center justify-center text-zinc-500">
      <Spinner size={28} />
    </div>
  );
}
