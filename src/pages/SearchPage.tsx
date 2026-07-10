import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSearchPlaylists, useSearchTracks, useSearchUsers } from "../api/queries";
import { IconSearch, Spinner } from "../components/Icons";
import { InfiniteTrackList } from "../components/InfiniteTrackList";
import { PlaylistRow } from "../components/PlaylistRow";
import { UserRow } from "../components/UserRow";
import { useScrollRestore } from "../lib/useScrollRestore";

type Tab = "tracks" | "artists" | "playlists";
const TABS: Tab[] = ["tracks", "artists", "playlists"];

export function SearchPage() {
  const [params] = useSearchParams();
  const [input, setInput] = useState(
    () => params.get("q") ?? sessionStorage.getItem("search-q") ?? "",
  );
  const [query, setQuery] = useState(input);
  // Like the query, the active tab survives leaving and coming back.
  const [tab, setTabState] = useState<Tab>(() => {
    const saved = sessionStorage.getItem("search-tab") as Tab | null;
    return saved && TABS.includes(saved) ? saved : "tracks";
  });
  const setTab = (t: Tab) => {
    setTabState(t);
    sessionStorage.setItem("search-tab", t);
  };

  // Deep-link from the ⌘K overlay: when the URL query changes (incl. while this
  // page is already mounted), adopt it.
  useEffect(() => {
    const q = params.get("q");
    if (q != null) {
      setInput(q);
      setQuery(q.trim());
    }
  }, [params]);

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
  const { data, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, isLoading } =
    useSearchTracks(query);
  const tracks = useMemo(() => data?.pages.flatMap((p) => p.collection) ?? [], [data]);
  if (isLoading) return <Loading />;
  return (
    <InfiniteTrackList
      tracks={tracks}
      hasNextPage={!!hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      fetchNextPage={() => void fetchNextPage()}
      fetchFailed={isFetchNextPageError}
      scrollScope="search-tracks"
    />
  );
}

function ArtistResults({ query }: { query: string }) {
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } =
    useSearchUsers(query);
  const users = useMemo(() => data?.pages.flatMap((p) => p.collection) ?? [], [data]);
  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollRestore(scrollRef, users.length > 0, "search-artists");
  if (isLoading) return <Loading />;
  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-4 pb-4">
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

function PlaylistResults({ query }: { query: string }) {
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading } =
    useSearchPlaylists(query);
  const playlists = useMemo(() => data?.pages.flatMap((p) => p.collection) ?? [], [data]);
  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollRestore(scrollRef, playlists.length > 0, "search-playlists");
  if (isLoading) return <Loading />;
  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-4 pb-4">
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
