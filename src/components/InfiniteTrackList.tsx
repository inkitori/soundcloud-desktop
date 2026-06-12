import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";
import type { Track } from "../api/types";
import { playContext } from "../player/queueStore";
import { Spinner } from "./Icons";
import { TrackRow } from "./TrackRow";

interface InfiniteTrackListProps {
  tracks: Track[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  /** A next-page fetch failed; stop auto-fetching or the effect hot-loops. */
  fetchFailed?: boolean;
  header?: React.ReactNode;
}

/** Virtualized track list with bottom-sentinel infinite scrolling. */
export function InfiniteTrackList({
  tracks,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  fetchFailed = false,
  header,
}: InfiniteTrackListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const more = hasNextPage && !fetchFailed;
  const count = tracks.length + (more ? 1 : 0);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 12,
  });

  const items = virtualizer.getVirtualItems();
  const lastItem = items[items.length - 1];

  useEffect(() => {
    if (!lastItem) return;
    if (lastItem.index >= tracks.length - 1 && more && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [lastItem?.index, tracks.length, more, isFetchingNextPage, fetchNextPage]);

  return (
    <div ref={parentRef} className="h-full overflow-y-auto px-4 pb-4">
      {header}
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => {
          const track = tracks[item.index];
          return (
            <div
              key={item.key}
              className="absolute left-0 top-0 w-full"
              style={{ height: item.size, transform: `translateY(${item.start}px)` }}
            >
              {track ? (
                <TrackRow track={track} onPlay={() => playContext(tracks, item.index)} />
              ) : (
                <div className="flex h-14 items-center justify-center text-zinc-500">
                  <Spinner />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
