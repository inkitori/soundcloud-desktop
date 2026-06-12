import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSearchPlaylists, useSearchTracks, useSearchUsers } from "../api/queries";
import type { User } from "../api/types";
import { IconSearch, Spinner } from "../components/Icons";
import { InfiniteTrackList } from "../components/InfiniteTrackList";
import { PlaylistRow } from "../components/PlaylistRow";
import { artwork, fmtCount } from "../lib/format";

type Tab = "tracks" | "artists" | "playlists";

export function SearchPage() {
  const [input, setInput] = useState(() => sessionStorage.getItem("search-q") ?? "");
  const [query, setQuery] = useState(input);
  const [tab, setTab] = useState<Tab>("tracks");

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(input.trim());
      sessionStorage.setItem("search-q", input.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [input]);

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-6 pt-5">
        <div className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 focus-within:border-orange-500">
          <IconSearch size={16} className="text-zinc-500" />
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search tracks, artists, playlists…"
            className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          />
        </div>
        <div className="flex gap-1 py-3">
          {(["tracks", "artists", "playlists"] as Tab[]).map((t) => (
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
        {query.length < 2 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600">
            Type to search SoundCloud
          </div>
        ) : tab === "tracks" ? (
          <TrackResults query={query} />
        ) : tab === "artists" ? (
          <ArtistResults query={query} />
        ) : (
          <PlaylistResults query={query} />
        )}
      </div>
    </div>
  );
}

function TrackResults({ query }: { query: string }) {
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } =
    useSearchTracks(query);
  const tracks = useMemo(() => data?.pages.flatMap((p) => p.collection) ?? [], [data]);
  if (isLoading) return <Loading />;
  return (
    <InfiniteTrackList
      tracks={tracks}
      hasNextPage={!!hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      fetchNextPage={() => void fetchNextPage()}
    />
  );
}

function ArtistResults({ query }: { query: string }) {
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } =
    useSearchUsers(query);
  const users = useMemo(() => data?.pages.flatMap((p) => p.collection) ?? [], [data]);
  if (isLoading) return <Loading />;
  return (
    <div className="h-full overflow-y-auto px-4 pb-4">
      <div className="space-y-1">
        {users.map((u) => (
          <UserRow key={u.id} user={u} />
        ))}
      </div>
      {hasNextPage && (
        <button
          onClick={() => void fetchNextPage()}
          disabled={isFetchingNextPage}
          className="mx-auto my-4 block rounded-full bg-white/5 px-4 py-1.5 text-xs text-zinc-300 hover:bg-white/10"
        >
          {isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}

function UserRow({ user }: { user: User }) {
  return (
    <Link
      to={`/artist/${user.id}`}
      className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-white/5"
    >
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-zinc-800">
        {user.avatar_url && (
          <img
            src={artwork(user.avatar_url, 120)!}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-zinc-100">{user.username}</div>
        <div className="text-xs text-zinc-500">
          {fmtCount(user.followers_count)} followers · {fmtCount(user.track_count)} tracks
        </div>
      </div>
    </Link>
  );
}

function PlaylistResults({ query }: { query: string }) {
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } =
    useSearchPlaylists(query);
  const playlists = useMemo(() => data?.pages.flatMap((p) => p.collection) ?? [], [data]);
  if (isLoading) return <Loading />;
  return (
    <div className="h-full overflow-y-auto px-4 pb-4">
      <div className="space-y-2">
        {playlists.map((p) => (
          <PlaylistRow key={p.id} playlist={p} />
        ))}
      </div>
      {hasNextPage && (
        <button
          onClick={() => void fetchNextPage()}
          disabled={isFetchingNextPage}
          className="mx-auto my-4 block rounded-full bg-white/5 px-4 py-1.5 text-xs text-zinc-300 hover:bg-white/10"
        >
          {isFetchingNextPage ? "Loading…" : "Load more"}
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
