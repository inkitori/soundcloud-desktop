import { useMemo, useRef } from "react";
import { useMyLikes } from "../api/queries";
import { Spinner } from "../components/Icons";
import { InfiniteTrackList } from "../components/InfiniteTrackList";
import { sessionUnliked } from "../lib/stores";

export function LikesPage() {
  const {
    data,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
    isLoading,
    error,
  } = useMyLikes();

  // Hide tracks unliked before this mount: the server can lag the unlike, but
  // a row unliked while on the page stays so the toggle can be undone.
  const hidden = useRef(new Set(sessionUnliked)).current;
  const tracks = useMemo(
    () =>
      (
        data?.pages.flatMap((p) => p.collection.flatMap((i) => (i.track ? [i.track] : []))) ?? []
      ).filter((t) => !hidden.has(t.id)),
    [data, hidden],
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
      fetchFailed={isFetchNextPageError}
      header={<h1 className="px-2 py-4 text-lg font-bold text-zinc-100">Liked tracks</h1>}
    />
  );
}
