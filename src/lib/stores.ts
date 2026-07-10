import type { InfiniteData } from "@tanstack/react-query";
import { create } from "zustand";
import { api } from "../api/commands";
import type { AppError, AuthStatus, CachedRow, FeedItem, Page, Track } from "../api/types";
import { openAuthModal } from "./modals";
import { queryClient } from "./queryClient";
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
    const prev = useAuthStore.getState().status;
    if (prev && (prev.me?.id ?? null) !== (status.me?.id ?? null)) {
      resetAccountState(status.logged_in);
    }
    useAuthStore.setState({ status, loading: false, expired: false });
  } catch (e) {
    console.error("auth_status failed", e);
    useAuthStore.setState({
      status: { logged_in: false, datadome_set: false },
      loading: false,
    });
  }
}

/**
 * Drop everything keyed to the previous account when the signed-in user
 * changes (disconnect, or connecting a different account): the query cache,
 * the optimistic id mirrors, and the once-per-session ids guard.
 */
function resetAccountState(loggedIn: boolean) {
  queryClient.clear();
  socialIdsLoaded = false;
  sessionUnliked.clear();
  sessionLikedTracks.clear();
  useLikedStore.setState({ ids: new Set() });
  useSocialStore.setState({
    repostedTracks: new Set(),
    repostedPlaylists: new Set(),
    likedPlaylists: new Set(),
    followedUsers: new Set(),
  });
  if (loggedIn) void loadSocialIds();
}

/**
 * Mark queries whose server data a write changed as stale without refetching
 * in place: lists you're looking at shouldn't reshuffle under the toggle, and
 * SoundCloud's indexes can lag a write by a moment, so refetching on the next
 * mount (e.g. navigating to the profile) is both calmer and more reliable.
 * Keys containing undefined (no signed-in user id) are skipped.
 */
function staleAfterWrite(...keys: unknown[][]) {
  for (const key of keys) {
    if (key.includes(undefined)) continue;
    void queryClient.invalidateQueries({ queryKey: key, refetchType: "none" });
  }
}

function myId(): number | undefined {
  return useAuthStore.getState().status?.me?.id;
}

/**
 * Unreposting must prune the entry from cached feed/repost pages directly:
 * a refetch would leave a ghost row in the meantime, and SoundCloud's stream
 * index lags unreposts anyway, so the refetched page may *still* contain it
 * (which is also why the caller skips invalidation — a refetch could
 * resurrect the row we just removed).
 */
function pruneMyRepostFromCaches(kind: "track" | "playlist", id: number) {
  const me = myId();
  const prune = (queryKey: unknown[], mineOnly: boolean) =>
    queryClient.setQueriesData<InfiniteData<Page<FeedItem>>>({ queryKey }, (data) => {
      if (!data) return data;
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          collection: page.collection.filter((item) => {
            if (!item.type.includes("repost")) return true;
            const entity = kind === "track" ? item.track : item.playlist;
            if (entity?.id !== id) return true;
            // In the feed, keep the same entity reposted by *other* people.
            return mineOnly && item.user?.id !== me;
          }),
        })),
      };
    });
  prune(["feed"], true);
  if (me != null) prune(["user-reposts", me], false);
}

// ---- likes (local mirror for instant heart toggles) ----

interface LikedState {
  ids: Set<number>;
}

export const useLikedStore = create<LikedState>(() => ({ ids: new Set() }));

/**
 * This session's like/unlike writes. SoundCloud's likes index lags writes in
 * both directions: an unliked track keeps coming back for a while (so a likes
 * refetch would re-mark it liked and the lists would keep showing it), and a
 * freshly liked track is missing from the list until the index catches up.
 * The lists overlay these on top of the server data (lib/sessionLikes.ts);
 * liked tracks are kept as full objects so they can be rendered directly.
 */
export const sessionUnliked = new Set<number>();
export const sessionLikedTracks = new Map<number, Track>();

export function markLiked(ids: number[]) {
  const fresh = ids.filter((id) => !sessionUnliked.has(id));
  if (fresh.length === 0) return;
  useLikedStore.setState((s) => {
    const next = new Set(s.ids);
    for (const id of fresh) next.add(id);
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

export async function toggleLikeTrack(track: Track) {
  const willLike = !useLikedStore.getState().ids.has(track.id);
  // Snapshot the overlay so a failed write can restore it exactly.
  const prevUnliked = sessionUnliked.has(track.id);
  const prevLiked = sessionLikedTracks.get(track.id);

  // Apply the overlay optimistically (mirroring the heart store) so navigating
  // to Likes right after the click already shows the change. The write routes
  // through the webview and can lag, and the Likes overlay snapshots at mount,
  // so a post-await update would otherwise be missed until the next visit.
  if (willLike) {
    sessionUnliked.delete(track.id);
    sessionLikedTracks.set(track.id, track);
  } else {
    sessionUnliked.add(track.id);
    sessionLikedTracks.delete(track.id);
  }

  const ok = await toggleInSet(
    () => useLikedStore.getState().ids,
    (ids) => useLikedStore.setState({ ids }),
    track.id,
    (on) => (on ? api.likeTrack(track.id) : api.unlikeTrack(track.id)),
    "like",
  );
  if (!ok) {
    // Restore the overlay to its pre-click state.
    if (prevUnliked) sessionUnliked.add(track.id);
    else sessionUnliked.delete(track.id);
    if (prevLiked) sessionLikedTracks.set(track.id, prevLiked);
    else sessionLikedTracks.delete(track.id);
    return;
  }
  staleAfterWrite(["my-likes"], ["user-likes", myId()]);
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
  if (!ok) return;
  if (useSocialStore.getState().repostedTracks.has(trackId)) {
    staleAfterWrite(["user-reposts", myId()], ["feed"]);
    showToast("Reposted to your followers");
  } else {
    pruneMyRepostFromCaches("track", trackId);
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
  if (!ok) return;
  if (useSocialStore.getState().repostedPlaylists.has(playlistId)) {
    staleAfterWrite(["user-reposts", myId()], ["feed"]);
    showToast("Reposted to your followers");
  } else {
    pruneMyRepostFromCaches("playlist", playlistId);
  }
}

export async function toggleLikePlaylist(playlistId: number) {
  const ok = await toggleInSet(
    () => useSocialStore.getState().likedPlaylists,
    (likedPlaylists) => useSocialStore.setState({ likedPlaylists }),
    playlistId,
    (on) => (on ? api.likePlaylist(playlistId) : api.unlikePlaylist(playlistId)),
    "like",
  );
  // The library list ("my-playlists") mixes in liked playlists.
  if (ok) staleAfterWrite(["my-playlists"]);
}

export async function toggleFollowUser(userId: number, username?: string | null) {
  const ok = await toggleInSet(
    () => useSocialStore.getState().followedUsers,
    (followedUsers) => useSocialStore.setState({ followedUsers }),
    userId,
    (on) => (on ? api.followUser(userId) : api.unfollowUser(userId)),
    "follow",
  );
  if (!ok) return;
  staleAfterWrite(
    ["user-followings", myId()],
    ["user-followers", userId],
    ["user", myId()],
    ["user", userId],
    ["feed"],
  );
  if (useSocialStore.getState().followedUsers.has(userId)) {
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

// ---- network (online / offline) ----

interface NetworkState {
  online: boolean;
}

export const useNetworkStore = create<NetworkState>(() => ({
  online: typeof navigator === "undefined" ? true : navigator.onLine,
}));

export function setOnline(online: boolean) {
  if (useNetworkStore.getState().online !== online) {
    useNetworkStore.setState({ online });
  }
}

/**
 * Track connectivity off the browser's online/offline events. navigator.onLine
 * in a webview flips reliably when the network interface goes up/down, which is
 * the case that matters for "only downloads are available." Read failures with
 * a `network` error code also flip us offline (see lib/events + api callers).
 */
export function initNetworkWatch() {
  window.addEventListener("online", () => setOnline(true));
  window.addEventListener("offline", () => setOnline(false));
}
