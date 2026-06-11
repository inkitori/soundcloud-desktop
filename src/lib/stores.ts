import { create } from "zustand";
import { api } from "../api/commands";
import type { AppError, AuthStatus, CachedRow } from "../api/types";
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

export async function toggleLikeTrack(trackId: number) {
  const liked = useLikedStore.getState().ids.has(trackId);
  useLikedStore.setState((s) => {
    const next = new Set(s.ids);
    if (liked) next.delete(trackId);
    else next.add(trackId);
    return { ids: next };
  });
  try {
    if (liked) await api.unlikeTrack(trackId);
    else await api.likeTrack(trackId);
  } catch (e) {
    console.error("like toggle failed", e);
    showToast(
      `Couldn't ${liked ? "unlike" : "like"}: ${(e as AppError).message ?? String(e)}`,
      "error",
    );
    // revert
    useLikedStore.setState((s) => {
      const next = new Set(s.ids);
      if (liked) next.add(trackId);
      else next.delete(trackId);
      return { ids: next };
    });
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
