import type { Track } from "../api/types";
import { audioController } from "./audioController";
import { usePlayerStore } from "./playerStore";
import { seedQueue, useQueueStore, type RepeatMode } from "./queueStore";

/**
 * Persist the queue + position so relaunching the app comes back paused where
 * the last session left off (track JSON stays resolvable — its
 * track_authorization doesn't expire — so no network is needed until play).
 */

const KEY = "player-session";
/** Track JSON is a few KB each; cap what we persist to keep writes cheap. */
const MAX_SAVED = 100;

interface SavedSession {
  tracks: Track[];
  index: number;
  position: number;
  repeat: RepeatMode;
  radio: boolean;
  shuffle: boolean;
  contextTo: string | null;
}

/** Suppress saves while restoring, so restore doesn't overwrite itself. */
let restoring = false;
let saveTimer: number | undefined;

function save() {
  if (restoring) return;
  const { items, index, repeat, radio, shuffle, contextTo } = useQueueStore.getState();
  const { track, position } = usePlayerStore.getState();
  if (!track || index < 0 || !items[index]) return;
  // Keep a window around the playing entry when the queue is huge (radio can
  // grow it unboundedly).
  const start = Math.max(0, Math.min(index - 25, items.length - MAX_SAVED));
  const session: SavedSession = {
    tracks: items.slice(start, start + MAX_SAVED).map((it) => it.track),
    index: index - start,
    position,
    repeat,
    radio,
    shuffle,
    contextTo,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Quota exceeded — losing resume beats crashing a save.
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(save, 500);
}

function restore() {
  let session: SavedSession | null = null;
  try {
    session = JSON.parse(localStorage.getItem(KEY) ?? "null") as SavedSession | null;
  } catch {
    return;
  }
  if (!session || !Array.isArray(session.tracks) || session.tracks.length === 0) return;
  const index = Math.min(Math.max(session.index ?? 0, 0), session.tracks.length - 1);
  restoring = true;
  try {
    seedQueue(session.tracks, index, {
      repeat: session.repeat ?? "off",
      radio: session.radio ?? true,
      shuffle: session.shuffle ?? false,
      contextTo: session.contextTo ?? null,
    });
    audioController.resumeTrack(session.tracks[index], session.position ?? 0);
  } finally {
    restoring = false;
  }
}

/** Call once at startup: restores the previous session, then keeps saving. */
export function initSessionResume() {
  restore();
  useQueueStore.subscribe(scheduleSave);
  // The queue subscription misses pure position changes; sample those.
  setInterval(() => {
    if (usePlayerStore.getState().status === "playing") save();
  }, 5000);
  window.addEventListener("beforeunload", save);
}
