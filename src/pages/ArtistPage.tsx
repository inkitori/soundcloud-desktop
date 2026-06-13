import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  useUser,
  useUserAlbums,
  useUserFollowers,
  useUserFollowings,
  useUserLikes,
  useUserPlaylists,
  useUserReposts,
  useUserToptracks,
  useUserTracks,
} from "../api/queries";
import { Spinner } from "../components/Icons";
import { InfiniteTrackList } from "../components/InfiniteTrackList";
import { PlaylistRow } from "../components/PlaylistRow";
import { TrackRow } from "../components/TrackRow";
import { UserRow } from "../components/UserRow";
import { artwork, fmtCount } from "../lib/format";
import { useSessionLikes } from "../lib/sessionLikes";
import { toggleFollowUser, useAuthStore, useSocialStore } from "../lib/stores";
import { playContext } from "../player/queueStore";

const TABS = [
  "popular",
  "tracks",
  "albums",
  "playlists",
  "reposts",
  "likes",
  "followers",
  "following",
] as const;
type Tab = (typeof TABS)[number];

/** Doubles as the user's own profile page (linked from the sidebar). */
export function ArtistPage() {
  const { id } = useParams();
  const userId = Number(id);
  const { data: user, isLoading, error } = useUser(userId);
  const [tab, setTab] = useState<Tab>("popular");
  const me = useAuthStore((s) => s.status?.me);
  const following = useSocialStore((s) => s.followedUsers.has(userId));
  const isMe = me?.id === userId;

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Couldn't load this artist: {(error as Error).message}
      </div>
    );
  }
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
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-bold text-zinc-50">
              {user.username}
              {user.verified && <span className="ml-2 text-sm text-sky-400">✓</span>}
              {isMe && (
                <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  You
                </span>
              )}
            </h1>
            <div className="text-sm text-zinc-400">
              <button onClick={() => setTab("followers")} className="hover:text-zinc-200">
                {fmtCount(user.followers_count)} followers
              </button>
              {" · "}
              <button onClick={() => setTab("following")} className="hover:text-zinc-200">
                {fmtCount(user.followings_count)} following
              </button>
              {" · "}
              {fmtCount(user.track_count)} tracks
              {user.city ? ` · ${user.city}` : ""}
            </div>
          </div>
          {!isMe && (
            <button
              onClick={() => void toggleFollowUser(userId, user.username)}
              className={`shrink-0 rounded-full px-5 py-2 text-sm font-semibold ${
                following
                  ? "border border-zinc-600 text-zinc-200 hover:border-zinc-400"
                  : "bg-orange-600 text-white hover:bg-orange-500"
              }`}
            >
              {following ? "Following" : "Follow"}
            </button>
          )}
        </div>
        <div className="flex gap-1 py-3">
          {TABS.map((t) => (
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
        {tab === "albums" && <UserPlaylistsTab userId={userId} kind="albums" />}
        {tab === "playlists" && <UserPlaylistsTab userId={userId} kind="playlists" />}
        {tab === "reposts" && <UserRepostsTab userId={userId} />}
        {tab === "likes" && <UserLikesTab userId={userId} />}
        {tab === "followers" && <UserListTab userId={userId} kind="followers" />}
        {tab === "following" && <UserListTab userId={userId} kind="following" />}
      </div>
    </div>
  );
}

function UserTrackTab({ userId, kind }: { userId: number; kind: "popular" | "tracks" }) {
  const top = useUserToptracks(userId, kind === "popular");
  const all = useUserTracks(userId, kind === "tracks");
  const q = kind === "popular" ? top : all;
  const tracks = useMemo(() => q.data?.pages.flatMap((p) => p.collection) ?? [], [q.data]);
  if (q.isLoading) return <Loading />;
  return (
    <InfiniteTrackList
      tracks={tracks}
      hasNextPage={!!q.hasNextPage}
      isFetchingNextPage={q.isFetchingNextPage}
      fetchNextPage={() => void q.fetchNextPage()}
      fetchFailed={q.isFetchNextPageError}
    />
  );
}

function UserLikesTab({ userId }: { userId: number }) {
  const q = useUserLikes(userId);
  const isMe = useAuthStore((s) => s.status?.me?.id === userId);
  const serverTracks = useMemo(
    () =>
      q.data?.pages.flatMap((p) => p.collection.flatMap((i) => (i.track ? [i.track] : []))) ?? [],
    [q.data],
  );
  // On your own profile, overlay this session's like/unlike writes while the
  // server index lags.
  const tracks = useSessionLikes(serverTracks, isMe);
  if (q.isLoading) return <Loading />;
  return (
    <InfiniteTrackList
      tracks={tracks}
      hasNextPage={!!q.hasNextPage}
      isFetchingNextPage={q.isFetchingNextPage}
      fetchNextPage={() => void q.fetchNextPage()}
      fetchFailed={q.isFetchNextPageError}
    />
  );
}

/** Reposted tracks play as one queue context; reposted playlists show as cards. */
function UserRepostsTab({ userId }: { userId: number }) {
  const q = useUserReposts(userId);
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.collection) ?? [], [q.data]);
  const tracks = useMemo(() => items.flatMap((i) => (i.track ? [i.track] : [])), [items]);
  if (q.isLoading) return <Loading />;
  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        No reposts yet
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto px-4 pb-4">
      <div className="space-y-1">
        {items.map((item, i) =>
          item.track ? (
            <TrackRow
              key={`t-${item.track.id}-${i}`}
              track={item.track}
              onPlay={() =>
                playContext(tracks, tracks.findIndex((t) => t.id === item.track!.id))
              }
            />
          ) : item.playlist ? (
            <PlaylistRow key={`p-${item.playlist.id}-${i}`} playlist={item.playlist} />
          ) : null,
        )}
      </div>
      {q.hasNextPage && (
        <button
          onClick={() => void q.fetchNextPage()}
          className="mx-auto my-4 block rounded-full bg-white/5 px-4 py-1.5 text-xs text-zinc-300 hover:bg-white/10"
        >
          {q.isFetchingNextPage ? <Spinner size={14} /> : "Load more"}
        </button>
      )}
    </div>
  );
}

function UserListTab({ userId, kind }: { userId: number; kind: "followers" | "following" }) {
  const followers = useUserFollowers(userId, kind === "followers");
  const followings = useUserFollowings(userId, kind === "following");
  const q = kind === "followers" ? followers : followings;
  const users = useMemo(() => q.data?.pages.flatMap((p) => p.collection) ?? [], [q.data]);
  if (q.isLoading) return <Loading />;
  if (users.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        {kind === "followers" ? "No followers yet" : "Not following anyone yet"}
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto px-4 pb-4">
      <div className="space-y-1">
        {users.map((u) => (
          <UserRow key={u.id} user={u} />
        ))}
      </div>
      {q.hasNextPage && (
        <button
          onClick={() => void q.fetchNextPage()}
          className="mx-auto my-4 block rounded-full bg-white/5 px-4 py-1.5 text-xs text-zinc-300 hover:bg-white/10"
        >
          {q.isFetchingNextPage ? <Spinner size={14} /> : "Load more"}
        </button>
      )}
    </div>
  );
}

function UserPlaylistsTab({ userId, kind }: { userId: number; kind: "albums" | "playlists" }) {
  const albums = useUserAlbums(userId, kind === "albums");
  const playlists = useUserPlaylists(userId, kind === "playlists");
  const q = kind === "albums" ? albums : playlists;
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.collection) ?? [], [q.data]);
  if (q.isLoading) return <Loading />;
  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        No {kind} yet
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto px-4 pb-4">
      <div className="space-y-2">
        {items.map((p) => (
          <PlaylistRow key={p.id} playlist={p} />
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
