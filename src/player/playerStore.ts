import { create } from "zustand";
import type { Track } from "../api/types";

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";

interface PlayerState {
  track: Track | null;
  /**
   * Stable identity of the playing queue entry (not the track id). The same
   * track can appear in several feed rows — reposted by different people, or an
   * artist's own post plus a repost — so highlighting keys off this, letting
   * exactly one row light up. Null when nothing is playing.
   */
  entryKey: string | null;
  status: PlayerStatus;
  /** seconds */
  position: number;
  /** seconds */
  duration: number;
  volume: number;
  sourceKind: "cached" | "stream" | null;
  snipped: boolean;
  error: string | null;
}

export const usePlayerStore = create<PlayerState>(() => ({
  track: null,
  entryKey: null,
  status: "idle",
  position: 0,
  duration: 0,
  volume: Number(localStorage.getItem("volume") ?? "1"),
  sourceKind: null,
  snipped: false,
  error: null,
}));
