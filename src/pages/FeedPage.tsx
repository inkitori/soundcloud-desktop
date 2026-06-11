import { useEffect, useMemo, useRef } from "react";
import { useFeed } from "../api/queries";
import type { FeedItem, Track } from "../api/types";
import { IconRadio, Spinner } from "../components/Icons";
import { PlaylistCard } from "../components/PlaylistCard";
import { TrackRow } from "../components/TrackRow";
import { playContext } from "../player/queueStore";

export function FeedPage() {
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading, error } = useFeed();
  const sentinelRef = useRef<HTMLDivElement>(null);

  // /stream pages can overlap at the boundary, so the same item (same entity
  // posted/reposted by the same actor) shows up twice — keep the first one.
  const items = useMemo(() => {
    const all = data?.pages.flatMap((p) => p.collection) ?? [];
    const seen = new Set<string>();
    const out: { item: FeedItem; key: string }[] = [];
    for (const item of all) {
      const key = feedItemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ item, key });
    }
    return out;
  }, [data]);
  const feedTracks = useMemo(
    () => items.flatMap(({ item }) => (item.track ? [item.track] : [])),
    [items],
  );

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

  if (isLoading) return <Centered><Spinner size={28} /></Centered>;
  if (error) return <Centered>Couldn't load your feed: {(error as Error).message}</Centered>;

  return (
    <div className="h-full overflow-y-auto px-4 pb-4">
      <h1 className="px-2 py-4 text-lg font-bold text-zinc-100">Your feed</h1>
      <div className="space-y-1">
        {items.map(({ item, key }) => (
          <FeedRow
            key={key}
            item={item}
            onPlayTrack={(track) =>
              playContext(feedTracks, feedTracks.findIndex((t) => t.id === track.id))
            }
          />
        ))}
      </div>
      <div ref={sentinelRef} className="flex justify-center py-6 text-zinc-500">
        {isFetchingNextPage && <Spinner />}
      </div>
    </div>
  );
}

function feedItemKey(item: FeedItem): string {
  return [
    item.type,
    item.track?.id ?? "",
    item.playlist?.id ?? "",
    item.user?.id ?? "",
  ].join(":");
}

function FeedRow({
  item,
  onPlayTrack,
}: {
  item: FeedItem;
  onPlayTrack: (track: Track) => void;
}) {
  const isRepost = item.type.includes("repost");
  const attribution = isRepost && item.user?.username && (
    <div className="flex items-center gap-1.5 px-2 pt-1 text-[11px] text-zinc-500">
      <IconRadio size={11} />
      reposted by {item.user.username}
    </div>
  );

  if (item.track) {
    return (
      <div>
        {attribution}
        <TrackRow track={item.track} onPlay={() => onPlayTrack(item.track!)} />
      </div>
    );
  }
  if (item.playlist) {
    return (
      <div>
        {attribution}
        <div className="px-2 py-1">
          <PlaylistCard playlist={item.playlist} />
        </div>
      </div>
    );
  }
  return null;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-zinc-500">{children}</div>
  );
}
