import { useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { create } from "zustand";
import { api } from "../api/commands";
import type { Track } from "../api/types";
import { startDownload } from "../lib/downloads";
import { isBlocked, trackTitle } from "../lib/format";
import { openAddToPlaylist } from "../lib/modals";
import {
  refreshDownloads,
  toggleLikeTrack,
  toggleRepostTrack,
  useDownloadStore,
  useLikedStore,
  useSocialStore,
} from "../lib/stores";
import { showToast } from "../lib/toast";
import { addLast } from "../player/queueStore";
import {
  IconCheck,
  IconDownload,
  IconExternal,
  IconHeart,
  IconHeartFilled,
  IconPlay,
  IconPlaylistAdd,
  IconPlus,
  IconRepost,
  IconUser,
} from "./Icons";

interface MenuState {
  x: number;
  y: number;
  track: Track;
  onPlay?: () => void;
}

const useMenuStore = create<{ menu: MenuState | null }>(() => ({ menu: null }));

export function openTrackMenu(
  e: { clientX: number; clientY: number },
  track: Track,
  onPlay?: () => void,
) {
  useMenuStore.setState({ menu: { x: e.clientX, y: e.clientY, track, onPlay } });
}

const close = () => useMenuStore.setState({ menu: null });

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // WKWebView can reject the async clipboard API; the selection fallback works.
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

/** Right-click menu for track rows. Mounted once in App. */
export function TrackContextMenu() {
  const menu = useMenuStore((s) => s.menu);
  return menu ? <MenuPanel key={`${menu.track.id}:${menu.x}:${menu.y}`} menu={menu} /> : null;
}

function MenuPanel({ menu }: { menu: MenuState }) {
  const { track } = menu;
  const navigate = useNavigate();
  const liked = useLikedStore((s) => s.ids.has(track.id));
  const reposted = useSocialStore((s) => s.repostedTracks.has(track.id));
  const cached = useDownloadStore((s) => track.id in s.cached);
  const blocked = isBlocked(track);

  // Render at the click point, then clamp into the viewport once measured.
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.min(menu.x, window.innerWidth - width - 8),
      y: Math.min(menu.y, window.innerHeight - height - 8),
    });
  }, [menu]);

  const item = (
    icon: React.ReactNode,
    label: string,
    onClick: () => void,
    disabled = false,
  ) => (
    <button
      onClick={() => {
        close();
        onClick();
      }}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-[13px] text-zinc-200 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <span className="text-zinc-400">{icon}</span>
      {label}
    </button>
  );
  const divider = <div className="my-1 h-px bg-white/10" />;

  return (
    // Transparent backdrop swallows the next click/right-click anywhere else.
    <div
      className="fixed inset-0 z-50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        role="menu"
        style={{ left: pos.x, top: pos.y }}
        className="absolute w-56 rounded-lg border border-zinc-700/80 bg-zinc-900/95 p-1 shadow-2xl backdrop-blur"
      >
        {menu.onPlay && item(<IconPlay size={14} />, "Play", menu.onPlay, blocked)}
        {item(
          <IconPlus size={14} />,
          "Add to queue",
          () => {
            addLast(track);
            showToast(`Added "${trackTitle(track)}" to queue`);
          },
          blocked,
        )}
        {item(<IconPlaylistAdd size={14} />, "Add to playlist…", () => openAddToPlaylist(track))}
        {divider}
        {item(
          liked ? <IconHeartFilled size={14} /> : <IconHeart size={14} />,
          liked ? "Unlike" : "Like",
          () => void toggleLikeTrack(track),
        )}
        {item(<IconRepost size={14} />, reposted ? "Remove repost" : "Repost", () =>
          void toggleRepostTrack(track.id),
        )}
        {cached
          ? item(<IconCheck size={14} />, "Remove download", () => {
              void api.removeDownload(track.id).then(() => refreshDownloads());
            })
          : item(
              <IconDownload size={14} />,
              "Download",
              () => startDownload(track.id),
              blocked,
            )}
        {divider}
        {!!track.user?.id &&
          item(<IconUser size={14} />, "Go to artist", () =>
            navigate(`/artist/${track.user!.id}`),
          )}
        {!!track.permalink_url &&
          item(<IconExternal size={14} />, "Copy link", () => {
            void copyText(track.permalink_url!).then(() => showToast("Link copied"));
          })}
      </div>
    </div>
  );
}
