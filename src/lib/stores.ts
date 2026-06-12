import { create } from "zustand";
import { api } from "../api/commands";
import type { AppError, AuthStatus, CachedRow } from "../api/types";
import { openAuthModal } from "./modals";
import { showToast } from "./toast";

// ---- auth ----

interface AuthState {
  status: AuthStatus | null;
  loading: boolean;
  expired: boolean;
}

export const useAuthStore = create<AuthState>(() => ({
  status: null,
  loading: true,
  expired: false,
}));

export async function refreshAuth() {
  try {
    const status = await api.authStatus();
    useAuthStore.setState({ status, loading: false, expired: false });
  } catch (e) {
    console.error("auth_status failed", e);
    useAuthStore.setState({
      status: { logged_in: false, datadome_set: false },
      loading: false,
    });
  }
}

// ---- likes (local mirror for instant heart toggles) ----

interface LikedState {
  ids: Set<number>;
}

export const useLikedStore = create<LikedState>(() => ({ ids: new Set() }));

export function markLiked(ids: number[]) {
  if (ids.length === 0) return;
  useLikedStore.setState((s) => {
    const next = new Set(s.ids);
    for (const id of ids) next.add(id);
    return { ids: next };
  });
}

/**
 * Route a failed write to the right surface: bot-protection and expired-token
 * failures get the modal (with a fix), everything else a toast.
 */
export function handleWriteError(e: unknown, what: string) {
  console.error(`${what} failed`, e);
  const err = e as AppError;
  if (err?.code === "bot_challenge") {
    openAuthModal("writeBlocked");
    return;
  }
  if (err?.code === "token_expired") {
    openAuthModal("expired");
    return;
  }
  showToast(`Couldn't ${what}: ${err?.message ?? String(e)}`, "error");
}

/** Optimistic toggle over a Set-of-ids store with revert on failure. */
async function toggleInSet(
  get: () => Set<number>,
  set: (ids: Set<number>) => void,
  id: number,
  call: (on: boolean) => Promise<void>,
  what: string,
): Promise<boolean> {
  const wasOn = get().has(id);
  const apply = (on: boolean) => {
    const next = new Set(get());
    if (on) next.add(id);
    else next.delete(id);
    set(next);
  };
  apply(!wasOn);
  try {
    await call(!wasOn);
    return true;
  } catch (e) {
    apply(wasOn); // revert
    handleWriteError(e, what);
    return false;
  }
}

export async function toggleLikeTrack(trackId: number) {
  await toggleInSet(
    () => useLikedStore.getState().ids,
    (ids) => useLikedStore.setState({ ids }),
    trackId,
    (on) => (on ? api.likeTrack(trackId) : api.unlikeTrack(trackId)),
    "like",
  );
}

// ---- reposts / follows / playlist likes (same optimistic-set pattern) ----

interface SocialState {
  repostedTracks: Set<number>;
  repostedPlaylists: Set<number>;
  likedPlaylists: Set<number>;
  followedUsers: Set<number>;
}

export const useSocialStore = create<SocialState>(() => ({
  repostedTracks: new Set(),
  repostedPlaylists: new Set(),
  likedPlaylists: new Set(),
  followedUsers: new Set(),
}));

let socialIdsLoaded = false;

/**
 * Mirror the full liked/reposted/followed id sets so toggles show the right
 * state everywhere. Five paged api-v2 calls behind the global rate limiter,
 * so callers should delay this until after the first screen has painted.
 */
export async function loadSocialIds(force = false) {
  if (socialIdsLoaded && !force) return;
  socialIdsLoaded = true;
  try {
    const ids = await api.getSocialIds();
    markLiked(ids.liked_tracks);
    useSocialStore.setState({
      repostedTracks: new Set(ids.reposted_tracks),
      repostedPlaylists: new Set(ids.reposted_playlists),
      likedPlaylists: new Set(ids.liked_playlists),
      followedUsers: new Set(ids.followed_users),
    });
  } catch (e) {
    socialIdsLoaded = false;
    console.error("social ids load failed", e);
  }
}

export async function toggleRepostTrack(trackId: number) {
  const ok = await toggleInSet(
    () => useSocialStore.getState().repostedTracks,
    (repostedTracks) => useSocialStore.setState({ repostedTracks }),
    trackId,
    (on) => (on ? api.repostTrack(trackId) : api.unrepostTrack(trackId)),
    "repost",
  );
  if (ok && useSocialStore.getState().repostedTracks.has(trackId)) {
    showToast("Reposted to your followers");
  }
}

export async function toggleRepostPlaylist(playlistId: number) {
  const ok = await toggleInSet(
    () => useSocialStore.getState().repostedPlaylists,
    (repostedPlaylists) => useSocialStore.setState({ repostedPlaylists }),
    playlistId,
    (on) => (on ? api.repostPlaylist(playlistId) : api.unrepostPlaylist(playlistId)),
    "repost",
  );
  if (ok && useSocialStore.getState().repostedPlaylists.has(playlistId)) {
    showToast("Reposted to your followers");
  }
}

export async function toggleLikePlaylist(playlistId: number) {
  await toggleInSet(
    () => useSocialStore.getState().likedPlaylists,
    (likedPlaylists) => useSocialStore.setState({ likedPlaylists }),
    playlistId,
    (on) => (on ? api.likePlaylist(playlistId) : api.unlikePlaylist(playlistId)),
    "like",
  );
}

export async function toggleFollowUser(userId: number, username?: string | null) {
  const ok = await toggleInSet(
    () => useSocialStore.getState().followedUsers,
    (followedUsers) => useSocialStore.setState({ followedUsers }),
    userId,
    (on) => (on ? api.followUser(userId) : api.unfollowUser(userId)),
    "follow",
  );
  if (ok && useSocialStore.getState().followedUsers.has(userId)) {
    showToast(`Following ${username ?? "user"}`);
  }
}

// ---- downloads ----

export type DownloadStatus = "downloading" | "done" | "error";

interface DownloadState {
  cached: Record<number, CachedRow>;
  progress: Record<number, number>;
}

export const useDownloadStore = create<DownloadState>(() => ({
  cached: {},
  progress: {},
}));

export async function refreshDownloads() {
  try {
    const rows = await api.listDownloads();
    const cached: Record<number, CachedRow> = {};
    for (const row of rows) cached[row.track_id] = row;
    useDownloadStore.setState({ cached });
  } catch (e) {
    console.error("list_downloads failed", e);
  }
}

export function setDownloadProgress(trackId: number, pct: number | null) {
  useDownloadStore.setState((s) => {
    const progress = { ...s.progress };
    if (pct == null) delete progress[trackId];
    else progress[trackId] = pct;
    return { progress };
  });
}
