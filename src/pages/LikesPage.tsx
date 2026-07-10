import { useMemo } from "react";
import { useMyLikes } from "../api/queries";
import { IconDownload, Spinner } from "../components/Icons";
import { InfiniteTrackList } from "../components/InfiniteTrackList";
import { downloadTracks } from "../lib/downloads";
import { useSessionLikes } from "../lib/sessionLikes";

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

  const serverTracks = useMemo(
    () => data?.pages.flatMap((p) => p.collection.flatMap((i) => (i.track ? [i.track] : []))) ?? [],
    [data],
  );
  const tracks = useSessionLikes(serverTracks);

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
      contextTo="/likes"
      tracks={tracks}
      hasNextPage={!!hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      fetchNextPage={() => void fetchNextPage()}
      fetchFailed={isFetchNextPageError}
      header={
        <div className="flex items-center justify-between gap-3 px-2 py-4">
          <h1 className="text-lg font-bold text-zinc-100">Liked tracks</h1>
          {tracks.length > 0 && (
            <button
              onClick={() => void downloadTracks(tracks, "Liked tracks")}
              className="flex items-center gap-2 rounded-full border border-zinc-700 px-3.5 py-1.5 text-xs font-semibold text-zinc-300 hover:border-zinc-500"
              title="Download loaded likes for offline"
            >
              <IconDownload size={13} /> Download
            </button>
          )}
        </div>
      }
    />
  );
}
