import { useMemo } from "react";
import { useMyLikes } from "../api/queries";
import { Spinner } from "../components/Icons";
import { InfiniteTrackList } from "../components/InfiniteTrackList";

export function LikesPage() {
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading, error } = useMyLikes();

  const tracks = useMemo(
    () => data?.pages.flatMap((p) => p.collection.flatMap((i) => (i.track ? [i.track] : []))) ?? [],
    [data],
  );

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
        Couldn't load likes: {(error as Error).message}
      </div>
    );
  }

  return (
    <InfiniteTrackList
      tracks={tracks}
      hasNextPage={!!hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      fetchNextPage={() => void fetchNextPage()}
      header={<h1 className="px-2 py-4 text-lg font-bold text-zinc-100">Liked tracks</h1>}
    />
  );
}
