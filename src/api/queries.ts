import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { markLiked } from "../lib/stores";
import { api } from "./commands";
import type { Page } from "./types";

function useInfinite<T>(
  key: unknown[],
  fetcher: (next?: string) => Promise<Page<T>>,
  enabled = true,
  // When the key changes often (e.g. search-as-you-type), keep the previous
  // key's data visible while the next request loads instead of flashing empty.
  keepPrevious = false,
) {
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetcher(pageParam as string | undefined),
    initialPageParam: undefined as string | undefined,
    // api-v2 returns a next_href even on short/empty final pages; an empty
    // page is the only reliable end-of-list signal.
    getNextPageParam: (last) =>
      last.collection.length > 0 ? (last.next_href ?? undefined) : undefined,
    enabled,
    staleTime: 60_000,
    retry: 1,
    placeholderData: keepPrevious ? keepPreviousData : undefined,
  });
}

export function useFeed() {
  return useInfinite(["feed"], (next) => api.getStream(next));
}

export function useMyLikes() {
  return useInfinite(["my-likes"], async (next) => {
    const page = await api.getMyLikes(next);
    markLiked(page.collection.flatMap((i) => (i.track ? [i.track.id] : [])));
    return page;
  });
}

export function useMyPlaylists() {
  return useInfinite(["my-playlists"], (next) => api.getMyPlaylists(next));
}

export function usePlaylist(id: number) {
  return useQuery({
    queryKey: ["playlist", id],
    queryFn: () => api.getPlaylist(id),
    staleTime: 60_000,
  });
}

export function useTracksByIds(ids: number[]) {
  return useQuery({
    queryKey: ["tracks-by-ids", ids],
    queryFn: () => api.getTracksByIds(ids),
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
  });
}

export function useUser(id: number) {
  return useQuery({
    queryKey: ["user", id],
    queryFn: () => api.getUser(id),
    staleTime: 5 * 60_000,
  });
}

export function useUserTracks(id: number, enabled = true) {
  return useInfinite(["user-tracks", id], (next) => api.getUserTracks(id, next), enabled);
}

export function useUserToptracks(id: number, enabled = true) {
  return useInfinite(["user-toptracks", id], (next) => api.getUserToptracks(id, next), enabled);
}

export function useUserLikes(id: number) {
  return useInfinite(["user-likes", id], (next) => api.getUserLikes(id, next));
}

export function useUserPlaylists(id: number, enabled = true) {
  return useInfinite(["user-playlists", id], (next) => api.getUserPlaylists(id, next), enabled);
}

export function useUserAlbums(id: number, enabled = true) {
  return useInfinite(["user-albums", id], (next) => api.getUserAlbums(id, next), enabled);
}

export function useUserReposts(id: number) {
  return useInfinite(["user-reposts", id], (next) => api.getUserReposts(id, next));
}

export function useUserFollowers(id: number, enabled = true) {
  return useInfinite(["user-followers", id], (next) => api.getUserFollowers(id, next), enabled);
}

export function useUserFollowings(id: number, enabled = true) {
  return useInfinite(["user-followings", id], (next) => api.getUserFollowings(id, next), enabled);
}

export function useSearchTracks(q: string) {
  return useInfinite(
    ["search", "tracks", q],
    (next) => api.searchTracks(q, next),
    q.length > 1,
    true,
  );
}

export function useSearchUsers(q: string) {
  return useInfinite(
    ["search", "users", q],
    (next) => api.searchUsers(q, next),
    q.length > 1,
    true,
  );
}

export function useSearchPlaylists(q: string) {
  return useInfinite(
    ["search", "playlists", q],
    (next) => api.searchPlaylists(q, next),
    q.length > 1,
    true,
  );
}

export function useSearchAll(q: string) {
  return useInfinite(["search", "all", q], (next) => api.searchAll(q, next), q.length > 1, true);
}

export function useWaveform(url: string | null | undefined) {
  return useQuery({
    queryKey: ["waveform", url],
    queryFn: () => api.getWaveform(url!),
    enabled: !!url,
    staleTime: Infinity,
    retry: 1,
  });
}

export function useCacheStats() {
  return useQuery({
    queryKey: ["cache-stats"],
    queryFn: () => api.cacheStats(),
    refetchInterval: 10_000,
  });
}
