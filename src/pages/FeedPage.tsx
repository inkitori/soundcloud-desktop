import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { useFeed } from "../api/queries";
import type { FeedItem } from "../api/types";
import { IconDownload, IconRadio, Spinner } from "../components/Icons";
import { PlaylistRow } from "../components/PlaylistRow";
import { TrackRow } from "../components/TrackRow";
import { useNetworkStore } from "../lib/stores";
import { useListSelection } from "../lib/useListSelection";
import { useScrollRestore } from "../lib/useScrollRestore";
import { usePlayerStore } from "../player/playerStore";
import { playContext } from "../player/queueStore";

export function FeedPage() {
  const {
    data,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
    isLoading,
    error,
  } = useFeed();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const online = useNetworkStore((s) => s.online);

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
  // Playable feed rows paired with their stable key. The same track can appear
  // in several rows (reposted by different people); the key disambiguates which
  // row is playing, while playContext de-dupes the actual queue by track id.
  const feedPlayable = useMemo(
    () => items.flatMap(({ item, key }) => (item.track ? [{ track: item.track, key }] : [])),
    [items],
  );
  const currentKey = usePlayerStore((s) => s.entryKey);

  const playFromKey = (key: string) => {
    const idx = feedPlayable.findIndex((p) => p.key === key);
    if (idx < 0) return;
    playContext(
      feedPlayable.map((p) => p.track),
      idx,
      feedPlayable.map((p) => p.key),
      "/",
    );
  };

  // Keyboard selection walks the playable (track) rows, skipping playlists.
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const [selected, setSelected] = useListSelection(
    feedPlayable.length,
    (i) => playFromKey(feedPlayable[i].key),
    (i) => {
      const key = feedPlayable[i]?.key;
      if (key) rowRefs.current.get(key)?.scrollIntoView({ block: "nearest" });
    },
  );
  const selectedKey = selected != null ? (feedPlayable[selected]?.key ?? null) : null;
  const selectKey = (key: string) => {
    const idx = feedPlayable.findIndex((p) => p.key === key);
    if (idx >= 0) setSelected(idx);
  };

  useScrollRestore(scrollRef, items.length > 0);

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

  if (!online && !data) return <OfflineNotice />;
  if (isLoading) return <Centered><Spinner size={28} /></Centered>;
  if (error) {
    return online ? (
      <Centered>Couldn't load your feed: {(error as Error).message}</Centered>
    ) : (
      <OfflineNotice />
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-4 pb-4">
      <h1 className="px-2 py-4 text-lg font-bold text-zinc-100">Your feed</h1>
      <div className="space-y-1">
        {items.map(({ item, key }) => (
          <div
            key={key}
            ref={(el) => {
              if (el) rowRefs.current.set(key, el);
              else rowRefs.current.delete(key);
            }}
          >
            <FeedRow
              item={item}
              isCurrent={currentKey === key}
              onPlay={() => playFromKey(key)}
              selected={selectedKey === key}
              onSelect={() => selectKey(key)}
            />
          </div>
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
  isCurrent,
  onPlay,
  selected,
  onSelect,
}: {
  item: FeedItem;
  isCurrent: boolean;
  onPlay: () => void;
  selected: boolean;
  onSelect: () => void;
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
        <TrackRow
          track={item.track}
          isCurrent={isCurrent}
          onPlay={onPlay}
          selected={selected}
          onSelect={onSelect}
        />
      </div>
    );
  }
  if (item.playlist) {
    return (
      <div>
        {attribution}
        <PlaylistRow playlist={item.playlist} />
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

function OfflineNotice() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-zinc-500">
      <IconDownload size={36} className="text-zinc-600" />
      <p className="text-sm">You're offline</p>
      <Link
        to="/downloads"
        className="flex items-center gap-2 rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-500"
      >
        Go to your downloads
      </Link>
    </div>
  );
}
