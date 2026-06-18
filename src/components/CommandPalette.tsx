import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSearchAll } from "../api/queries";
import type { Playlist, Track, User } from "../api/types";
import { artwork, fmtCount, trackArt, trackArtist, trackTitle } from "../lib/format";
import { closeCommandPalette, useCommandPalette } from "../lib/commandPalette";
import { playPlaylist } from "../player/playPlaylist";
import { playContext } from "../player/queueStore";
import { IconList, IconSearch, IconUser, Spinner } from "./Icons";

type Item =
  | { kind: "track"; track: Track }
  | { kind: "artist"; user: User }
  | { kind: "playlist"; playlist: Playlist }
  | { kind: "showAll" };

/** Mount the inner palette only while open so its search hooks reset each time. */
export function CommandPalette() {
  const open = useCommandPalette((s) => s.open);
  if (!open) return null;
  return <CommandPaletteInner />;
}

function CommandPaletteInner() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  // Debounce the raw input into the query that drives the search hooks. Kept
  // short so results start loading quickly; previous results stay on screen
  // (keepPreviousData) so a new keystroke never blanks the list.
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 150);
    return () => clearTimeout(t);
  }, [input]);

  const hasQuery = query.length > 1;
  const searchQ = useSearchAll(query);

  const MAX_RESULTS = 16;

  // One flat list in SoundCloud's relevance order; first row is the default
  // highlight (no separate "top result" card). `user` -> `artist` Item kind.
  const items = useMemo<Item[]>(() => {
    if (!hasQuery) return [];
    const collection = (searchQ.data?.pages[0]?.collection ?? []).slice(0, MAX_RESULTS);
    const mapped = collection.map((it): Item => {
      if (it.kind === "track") return { kind: "track", track: it.track };
      if (it.kind === "user") return { kind: "artist", user: it.user };
      return { kind: "playlist", playlist: it.playlist };
    });
    return [...mapped, { kind: "showAll" }];
  }, [hasQuery, searchQ.data]);

  // Tracks in list order, so playing one flows next/prev through search tracks.
  const trackList = useMemo(
    () => items.flatMap((it) => (it.kind === "track" ? [it.track] : [])),
    [items],
  );

  // Keep the highlight inside the current item range.
  useEffect(() => {
    setHighlight((h) => Math.min(Math.max(h, 0), Math.max(0, items.length - 1)));
  }, [items.length]);

  // Esc closes from anywhere in the overlay (matches Modal.tsx).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCommandPalette();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // isLoading is only true on the first fetch for a term with no prior data;
  // once keepPreviousData kicks in, refetches surface via isFetching instead.
  const anyLoading = hasQuery && searchQ.isLoading;
  const anyFetching = hasQuery && searchQ.isFetching;
  const noResults = hasQuery && !anyLoading && trackList.length === 0 && items.length <= 1;

  const goSearch = () => {
    navigate(`/search?q=${encodeURIComponent(query)}`);
    closeCommandPalette();
  };

  // Play a result track within the visible track results so next/prev flow.
  const playTrack = (track: Track) => {
    const idx = trackList.findIndex((t) => t.id === track.id);
    playContext(trackList, Math.max(0, idx));
  };

  // Enter / click: act and close.
  const activate = (item: Item) => {
    switch (item.kind) {
      case "track":
        playTrack(item.track);
        closeCommandPalette();
        break;
      case "artist":
        navigate(`/artist/${item.user.id}`);
        closeCommandPalette();
        break;
      case "playlist":
        navigate(`/playlist/${item.playlist.id}`);
        closeCommandPalette();
        break;
      case "showAll":
        goSearch();
        break;
    }
  };

  // Shift+Enter: play and keep the overlay open (tracks + playlists); else fall back.
  const playStay = (item: Item) => {
    switch (item.kind) {
      case "track":
        playTrack(item.track);
        break;
      case "playlist":
        void playPlaylist(item.playlist);
        break;
      default:
        activate(item);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[highlight];
      if (!item) return;
      if (e.shiftKey) playStay(item);
      else activate(item);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeCommandPalette();
      }}
    >
      <div className="w-[34rem] max-w-[92vw] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
          <IconSearch size={16} className="text-zinc-500" />
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search tracks, artists, playlists…"
            className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          {anyFetching && !anyLoading && (
            <Spinner size={14} className="shrink-0 text-zinc-500" />
          )}
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-2">
          {!hasQuery ? (
            <div className="px-4 py-6 text-center text-sm text-zinc-600">
              Type to search SoundCloud
            </div>
          ) : anyLoading && items.length <= 1 ? (
            <div className="flex justify-center py-8 text-zinc-500">
              <Spinner size={24} />
            </div>
          ) : noResults ? (
            <>
              <div className="px-4 py-5 text-center text-sm text-zinc-600">No results</div>
              <Row
                item={{ kind: "showAll" }}
                index={items.length - 1}
                active={highlight === items.length - 1}
                query={query}
                onHover={setHighlight}
                onActivate={activate}
              />
            </>
          ) : (
            <ResultList
              items={items}
              highlight={highlight}
              query={query}
              onHover={setHighlight}
              onActivate={activate}
            />
          )}
        </div>

        <div className="border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-600">
          ↑↓ navigate · ↵ open · ⇧↵ play · esc close
        </div>
      </div>
    </div>
  );
}

function ResultList({
  items,
  highlight,
  query,
  onHover,
  onActivate,
}: {
  items: Item[];
  highlight: number;
  query: string;
  onHover: (i: number) => void;
  onActivate: (item: Item) => void;
}) {
  return (
    <>
      {items.map((item, i) => (
        <Row
          key={i}
          item={item}
          index={i}
          active={i === highlight}
          query={query}
          onHover={onHover}
          onActivate={onActivate}
        />
      ))}
    </>
  );
}

function Row({
  item,
  index,
  active,
  query,
  onHover,
  onActivate,
}: {
  item: Item;
  index: number;
  active: boolean;
  query: string;
  onHover: (i: number) => void;
  onActivate: (item: Item) => void;
}) {
  return (
    <button
      type="button"
      onMouseEnter={() => onHover(index)}
      onClick={() => onActivate(item)}
      className={`flex w-full items-center gap-3 px-4 py-2 text-left ${active ? "bg-white/10" : ""}`}
    >
      <RowContent item={item} query={query} />
      {item.kind !== "showAll" && <TypePill item={item} />}
    </button>
  );
}

function TypePill({ item }: { item: Exclude<Item, { kind: "showAll" }> }) {
  const label =
    item.kind === "track"
      ? "Track"
      : item.kind === "artist"
        ? "Artist"
        : item.playlist.is_album
          ? "Album"
          : "Playlist";
  return (
    <span className="ml-auto shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-zinc-400">
      {label}
    </span>
  );
}

function RowContent({ item, query }: { item: Item; query: string }) {
  switch (item.kind) {
    case "track":
      return (
        <>
          <Thumb src={trackArt(item.track, 120)} rounded="rounded" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-zinc-100">{trackTitle(item.track)}</div>
            <div className="truncate text-xs text-zinc-500">{trackArtist(item.track)}</div>
          </div>
        </>
      );
    case "artist":
      return (
        <>
          <Thumb
            src={artwork(item.user.avatar_url, 120)}
            rounded="rounded-full"
            fallback={<IconUser size={16} />}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-zinc-100">{item.user.username ?? "Unknown"}</div>
            <div className="truncate text-xs text-zinc-500">
              {item.user.followers_count != null
                ? `${fmtCount(item.user.followers_count)} followers`
                : "Artist"}
            </div>
          </div>
        </>
      );
    case "playlist":
      return (
        <>
          <Thumb
            src={artwork(
              item.playlist.artwork_url ??
                item.playlist.tracks[0]?.artwork_url ??
                item.playlist.user?.avatar_url,
              120,
            )}
            rounded="rounded"
            fallback={<IconList size={16} />}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-zinc-100">{item.playlist.title ?? "Untitled"}</div>
            <div className="truncate text-xs text-zinc-500">
              Playlist · {item.playlist.track_count ?? item.playlist.tracks.length} tracks
            </div>
          </div>
        </>
      );
    case "showAll":
      return (
        <>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-zinc-500">
            <IconSearch size={16} />
          </div>
          <div className="truncate text-sm text-zinc-300">Show all results for "{query}"</div>
        </>
      );
  }
}

function Thumb({
  src,
  rounded,
  fallback,
}: {
  src: string | null;
  rounded: string;
  fallback?: React.ReactNode;
}) {
  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden bg-zinc-800 text-zinc-600 ${rounded}`}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        fallback
      )}
    </div>
  );
}
