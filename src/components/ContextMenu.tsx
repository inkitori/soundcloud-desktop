import { useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { create } from "zustand";
import { api } from "../api/commands";
import type { Playlist, Track, User } from "../api/types";
import { downloadTracks, startDownload } from "../lib/downloads";
import { isBlocked, trackTitle } from "../lib/format";
import { openAddToPlaylist } from "../lib/modals";
import {
  refreshDownloads,
  toggleFollowUser,
  toggleLikePlaylist,
  toggleLikeTrack,
  toggleRepostPlaylist,
  toggleRepostTrack,
  useAuthStore,
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
  IconList,
  IconPlay,
  IconPlaylistAdd,
  IconPlus,
  IconRepost,
  IconUser,
} from "./Icons";

type MenuTarget =
  | { kind: "track"; track: Track; onPlay?: () => void }
  | { kind: "playlist"; playlist: Playlist; onPlay?: () => void }
  | { kind: "user"; user: User };

interface MenuState {
  x: number;
  y: number;
  target: MenuTarget;
}

const useMenuStore = create<{ menu: MenuState | null }>(() => ({ menu: null }));

type Point = { clientX: number; clientY: number };

export function openTrackMenu(e: Point, track: Track, onPlay?: () => void) {
  useMenuStore.setState({ menu: { x: e.clientX, y: e.clientY, target: { kind: "track", track, onPlay } } });
}

export function openPlaylistMenu(e: Point, playlist: Playlist, onPlay?: () => void) {
  useMenuStore.setState({
    menu: { x: e.clientX, y: e.clientY, target: { kind: "playlist", playlist, onPlay } },
  });
}

export function openUserMenu(e: Point, user: User) {
  useMenuStore.setState({ menu: { x: e.clientX, y: e.clientY, target: { kind: "user", user } } });
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

/** Right-click menu for tracks, playlists, and artists. Mounted once in App. */
export function AppContextMenu() {
  const menu = useMenuStore((s) => s.menu);
  if (!menu) return null;
  const id =
    menu.target.kind === "track"
      ? menu.target.track.id
      : menu.target.kind === "playlist"
        ? menu.target.playlist.id
        : menu.target.user.id;
  return <MenuPanel key={`${menu.target.kind}:${id}:${menu.x}:${menu.y}`} menu={menu} />;
}

function MenuPanel({ menu }: { menu: MenuState }) {
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
        {menu.target.kind === "track" && <TrackItems target={menu.target} />}
        {menu.target.kind === "playlist" && <PlaylistItems target={menu.target} />}
        {menu.target.kind === "user" && <UserItems target={menu.target} />}
      </div>
    </div>
  );
}

function Item({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
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
}

const Divider = () => <div className="my-1 h-px bg-white/10" />;

function TrackItems({ target }: { target: Extract<MenuTarget, { kind: "track" }> }) {
  const { track, onPlay } = target;
  const navigate = useNavigate();
  const liked = useLikedStore((s) => s.ids.has(track.id));
  const reposted = useSocialStore((s) => s.repostedTracks.has(track.id));
  const cached = useDownloadStore((s) => track.id in s.cached);
  const blocked = isBlocked(track);

  return (
    <>
      {onPlay && <Item icon={<IconPlay size={14} />} label="Play" onClick={onPlay} disabled={blocked} />}
      <Item
        icon={<IconPlus size={14} />}
        label="Add to queue"
        onClick={() => {
          addLast(track);
          showToast(`Added "${trackTitle(track)}" to queue`);
        }}
        disabled={blocked}
      />
      <Item
        icon={<IconPlaylistAdd size={14} />}
        label="Add to playlist…"
        onClick={() => openAddToPlaylist(track)}
      />
      <Divider />
      <Item
        icon={liked ? <IconHeartFilled size={14} /> : <IconHeart size={14} />}
        label={liked ? "Unlike" : "Like"}
        onClick={() => void toggleLikeTrack(track)}
      />
      <Item
        icon={<IconRepost size={14} />}
        label={reposted ? "Remove repost" : "Repost"}
        onClick={() => void toggleRepostTrack(track.id)}
      />
      {cached ? (
        <Item
          icon={<IconCheck size={14} />}
          label="Remove download"
          onClick={() => {
            void api.removeDownload(track.id).then(() => refreshDownloads());
          }}
        />
      ) : (
        <Item
          icon={<IconDownload size={14} />}
          label="Download"
          onClick={() => startDownload(track.id)}
          disabled={blocked}
        />
      )}
      <Divider />
      {!!track.user?.id && (
        <Item
          icon={<IconUser size={14} />}
          label="Go to artist"
          onClick={() => navigate(`/artist/${track.user!.id}`)}
        />
      )}
      {!!track.permalink_url && (
        <Item
          icon={<IconExternal size={14} />}
          label="Copy link"
          onClick={() => {
            void copyText(track.permalink_url!).then(() => showToast("Link copied"));
          }}
        />
      )}
    </>
  );
}

function PlaylistItems({ target }: { target: Extract<MenuTarget, { kind: "playlist" }> }) {
  const { playlist, onPlay } = target;
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.status?.me);
  const liked = useSocialStore((s) => s.likedPlaylists.has(playlist.id));
  const reposted = useSocialStore((s) => s.repostedPlaylists.has(playlist.id));
  const noun = playlist.is_album ? "album" : "playlist";
  const isMine = me != null && playlist.user?.id === me.id;

  return (
    <>
      {onPlay && <Item icon={<IconPlay size={14} />} label="Play" onClick={onPlay} />}
      <Item
        icon={<IconList size={14} />}
        label={`Go to ${noun}`}
        onClick={() => navigate(`/playlist/${playlist.id}`)}
      />
      <Divider />
      {!isMine && (
        <>
          <Item
            icon={liked ? <IconHeartFilled size={14} /> : <IconHeart size={14} />}
            label={liked ? "Unlike" : "Like"}
            onClick={() => void toggleLikePlaylist(playlist.id)}
          />
          <Item
            icon={<IconRepost size={14} />}
            label={reposted ? "Remove repost" : "Repost"}
            onClick={() => void toggleRepostPlaylist(playlist.id)}
          />
        </>
      )}
      <Item
        icon={<IconDownload size={14} />}
        label="Download all"
        onClick={() => void downloadTracks(playlist.tracks, playlist.title ?? noun)}
      />
      <Divider />
      {!!playlist.user?.id && (
        <Item
          icon={<IconUser size={14} />}
          label="Go to artist"
          onClick={() => navigate(`/artist/${playlist.user!.id}`)}
        />
      )}
      {!!playlist.permalink_url && (
        <Item
          icon={<IconExternal size={14} />}
          label="Copy link"
          onClick={() => {
            void copyText(playlist.permalink_url!).then(() => showToast("Link copied"));
          }}
        />
      )}
    </>
  );
}

function UserItems({ target }: { target: Extract<MenuTarget, { kind: "user" }> }) {
  const { user } = target;
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.status?.me);
  const following = useSocialStore((s) => s.followedUsers.has(user.id));
  const isMe = me?.id === user.id;

  return (
    <>
      <Item
        icon={<IconUser size={14} />}
        label="Go to artist"
        onClick={() => navigate(`/artist/${user.id}`)}
      />
      {!isMe && (
        <Item
          icon={following ? <IconCheck size={14} /> : <IconPlus size={14} />}
          label={following ? "Unfollow" : "Follow"}
          onClick={() => void toggleFollowUser(user.id, user.username)}
        />
      )}
      {!!user.permalink_url && (
        <Item
          icon={<IconExternal size={14} />}
          label="Copy link"
          onClick={() => {
            void copyText(user.permalink_url!).then(() => showToast("Link copied"));
          }}
        />
      )}
    </>
  );
}
