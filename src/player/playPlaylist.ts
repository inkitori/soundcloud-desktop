import { api } from "../api/commands";
import type { Playlist, Track } from "../api/types";
import { isStub } from "../lib/format";
import { queryClient } from "../lib/queryClient";
import { playContext } from "./queueStore";

/**
 * Play a playlist without navigating to its detail page. List endpoints embed
 * only the first ~5 full tracks (the rest are {id} stubs, or missing entirely),
 * so fetch what's needed first. Query keys mirror usePlaylist/useTracksByIds
 * so the detail page and this helper share a cache.
 */
export async function playPlaylist(playlist: Playlist, startTrackId?: number) {
  let entries = playlist.tracks;
  if (entries.length < (playlist.track_count ?? 0)) {
    const full = await queryClient.fetchQuery({
      queryKey: ["playlist", playlist.id],
      queryFn: () => api.getPlaylist(playlist.id),
      staleTime: 60_000,
    });
    entries = full.tracks;
  }

  const stubIds = entries.filter(isStub).map((t) => t.id);
  let tracks: Track[] = entries;
  if (stubIds.length > 0) {
    const hydrated = await queryClient.fetchQuery({
      queryKey: ["tracks-by-ids", stubIds],
      queryFn: () => api.getTracksByIds(stubIds),
      staleTime: 5 * 60_000,
    });
    const byId = new Map(hydrated.map((t) => [t.id, t]));
    tracks = entries.map((t) => byId.get(t.id) ?? t);
  }
  tracks = tracks.filter((t) => !isStub(t));
  if (tracks.length === 0) return;

  const index = startTrackId != null ? tracks.findIndex((t) => t.id === startTrackId) : 0;
  playContext(tracks, Math.max(0, index));
}
