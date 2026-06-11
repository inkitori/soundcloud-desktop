import { useEffect, useMemo, useRef } from "react";
import { useMyPlaylists } from "../api/queries";
import { Spinner } from "../components/Icons";
import { PlaylistCard } from "../components/PlaylistCard";

export function PlaylistsPage() {
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading, error } =
    useMyPlaylists();
  const sentinelRef = useRef<HTMLDivElement>(null);

  const playlists = useMemo(() => data?.pages.flatMap((p) => p.collection) ?? [], [data]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
        void fetchNextPage();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

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
    <div className="h-full overflow-y-auto px-4 pb-4">
      <h1 className="px-2 py-4 text-lg font-bold text-zinc-100">Playlists & albums</h1>
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
