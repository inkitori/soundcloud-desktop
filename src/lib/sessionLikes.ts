import { useMemo, useRef } from "react";
import type { Track } from "../api/types";
import { sessionLikedTracks, sessionUnliked } from "./stores";

/**
 * Overlay this session's like/unlike writes onto a server likes list:
 * SoundCloud's likes index lags writes, so freshly liked tracks are
 * prepended (newest first) and freshly unliked ones hidden. Both are frozen
 * at mount so the list never reshuffles while you're looking at it — a row
 * toggled in place stays put until the next visit.
 */
export function useSessionLikes(server: Track[], enabled = true): Track[] {
  const snapshot = useRef<{ hidden: Set<number>; added: Track[] } | null>(null);
  snapshot.current ??= {
    hidden: new Set(sessionUnliked),
    added: [...sessionLikedTracks.values()].reverse(),
  };
  return useMemo(() => {
    if (!enabled) return server;
    const { hidden, added } = snapshot.current!;
    const kept = server.filter((t) => !hidden.has(t.id));
    const ids = new Set(kept.map((t) => t.id));
    const extra = added.filter((t) => !ids.has(t.id));
    return extra.length > 0 ? [...extra, ...kept] : kept;
  }, [server, enabled]);
}
