import { create } from "zustand";
import type { Track } from "../api/types";

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";

interface PlayerState {
  track: Track | null;
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
  status: "idle",
  position: 0,
  duration: 0,
  volume: Number(localStorage.getItem("volume") ?? "1"),
  sourceKind: null,
  snipped: false,
  error: null,
}));
