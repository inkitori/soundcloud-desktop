import { useEffect, useMemo, useRef } from "react";
import { useMyPlaylists } from "../api/queries";
import { IconPlus, Spinner } from "../components/Icons";
import { PlaylistCard } from "../components/PlaylistCard";
import { openCreatePlaylist } from "../lib/modals";
import { useScrollRestore } from "../lib/useScrollRestore";

export function PlaylistsPage() {
  const {
    data,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
    isLoading,
    error,
  } = useMyPlaylists();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const playlists = useMemo(() => data?.pages.flatMap((p) => p.collection) ?? [], [data]);
  useScrollRestore(scrollRef, playlists.length > 0);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
        void fetchNextPage();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        <Spinner size={28} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Couldn't load playlists: {(error as Error).message}
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-4 pb-4">
      <div className="flex items-center justify-between px-2 py-4">
        <h1 className="text-lg font-bold text-zinc-100">Playlists & albums</h1>
        <button
          onClick={openCreatePlaylist}
          className="flex items-center gap-1.5 rounded-full bg-white/5 px-4 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10"
        >
          <IconPlus size={14} />
          New playlist
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {playlists.map((p) => (
          <PlaylistCard key={p.id} playlist={p} />
        ))}
      </div>
      <div ref={sentinelRef} className="flex justify-center py-6 text-zinc-500">
        {isFetchingNextPage && <Spinner />}
      </div>
    </div>
  );
}
