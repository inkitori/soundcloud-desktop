import { create } from "zustand";
import { api } from "../api/commands";
import type { Track } from "../api/types";
import { isBlocked, isSnipped } from "../lib/format";
import { audioController } from "./audioController";
import { usePlayerStore } from "./playerStore";

export type RepeatMode = "off" | "all" | "one";

/**
 * One slot in the play queue. `key` is a stable identity used for highlighting:
 * it carries the originating row's key when seeded from a list (so the exact
 * row you clicked lights up, even if the same track appears elsewhere), or a
 * synthetic id for queue-only entries (radio, "add to queue").
 */
export interface QueueItem {
  track: Track;
  key: string;
}

let keySeq = 0;
function synthKey(): string {
  keySeq += 1;
  return `q${keySeq}`;
}

interface QueueState {
  items: QueueItem[];
  index: number;
  repeat: RepeatMode;
  radio: boolean;
  shuffle: boolean;
  panelOpen: boolean;
  radioLoading: boolean;
  /** Route of the list this queue was seeded from (playlist, likes, …);
   * the player-bar title links here. Null for one-off plays. */
  contextTo: string | null;
}

export const useQueueStore = create<QueueState>(() => ({
  items: [],
  index: -1,
  repeat: "off",
  radio: true,
  shuffle: false,
  panelOpen: false,
  radioLoading: false,
  contextTo: null,
}));

const get = useQueueStore.getState;
const set = useQueueStore.setState;

function currentTrack(): Track | null {
  const { items, index } = get();
  return items[index]?.track ?? null;
}

async function playIndex(index: number) {
  const { items } = get();
  const entry = items[index];
  if (!entry) return;
  set({ index });
  usePlayerStore.setState({ entryKey: entry.key });
  await audioController.playTrack(entry.track);
  void maybeExtendRadio();
}

/**
 * Replace the queue with a list context (a page of likes, a playlist, the
 * feed, ...). Drops geo-blocked tracks and de-dupes by track id (keep first) so
 * the same song never plays twice — important for the feed, where one track can
 * be reposted by several people. `keys` (parallel to `tracks`) carries each
 * row's stable identity for highlighting; omit it for lists with no duplicates.
 */
export function playContext(
  tracks: Track[],
  startIndex: number,
  keys?: string[],
  contextTo?: string,
) {
  const target = tracks[startIndex];
  const clickedKey = keys?.[startIndex];
  const seen = new Set<number>();
  let items: QueueItem[] = [];
  tracks.forEach((track, i) => {
    if (isBlocked(track) || seen.has(track.id)) return;
    seen.add(track.id);
    items.push({ track, key: keys?.[i] ?? synthKey() });
  });
  if (items.length === 0) return;
  let index = items.findIndex((it) => it.track.id === target?.id);
  if (index >= 0) {
    // The de-duped queue keeps the first occurrence's slot, but if the user
    // clicked a later duplicate (e.g. a second repost), the highlight should
    // follow the row they actually clicked.
    if (clickedKey) items[index] = { track: items[index].track, key: clickedKey };
  } else {
    index = 0;
  }
  // With shuffle on, a new context starts with the clicked track and plays
  // the rest in random order (the pre-shuffle order is kept for toggle-off).
  if (get().shuffle && items.length > 1) {
    unshuffled = items;
    const current = items[index];
    const rest = items.filter((_, i) => i !== index);
    shuffleArray(rest);
    items = [current, ...rest];
    index = 0;
  }
  set({ items, index, contextTo: contextTo ?? null });
  void playIndex(index);
}

export function playNow(track: Track) {
  playContext([track], 0);
}

export function addNext(track: Track) {
  const { items, index } = get();
  const next = [...items];
  next.splice(index + 1, 0, { track, key: synthKey() });
  set({ items: next });
}

export function addLast(track: Track) {
  set({ items: [...get().items, { track, key: synthKey() }] });
}

export function removeAt(removeIndex: number) {
  const { items, index } = get();
  if (removeIndex === index) return; // don't remove the playing row
  const next = items.filter((_, i) => i !== removeIndex);
  set({ items: next, index: removeIndex < index ? index - 1 : index });
}

export function jumpTo(index: number) {
  void playIndex(index);
}

/** Drag-reorder: move a queue entry, keeping `index` on the same entry. */
export function moveItem(from: number, to: number) {
  const { items, index } = get();
  if (from === to || !items[from] || to < 0 || to >= items.length) return;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  let newIndex = index;
  if (from === index) {
    newIndex = to;
  } else {
    if (from < index) newIndex -= 1;
    if (to <= newIndex) newIndex += 1;
  }
  set({ items: next, index: newIndex });
}

/** Fisher–Yates, in place. */
function shuffleArray<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** The queue's pre-shuffle order, so turning shuffle off restores it. */
let unshuffled: QueueItem[] | null = null;

/**
 * Spotify semantics: on turns the rest of the queue random (current track
 * stays put, moved to the front); off restores the seeded order, keeping
 * rows added and dropping rows removed while shuffled.
 */
export function toggleShuffle() {
  const { shuffle, items, index } = get();
  if (!shuffle) {
    unshuffled = items;
    const current = items[index];
    const rest = items.filter((_, i) => i !== index);
    shuffleArray(rest);
    set({ shuffle: true, items: current ? [current, ...rest] : rest, index: current ? 0 : -1 });
    return;
  }
  const currentKey = items[index]?.key;
  const base = unshuffled ?? items;
  const live = new Set(items.map((it) => it.key));
  const known = new Set(base.map((it) => it.key));
  const restored = [
    ...base.filter((it) => live.has(it.key)),
    ...items.filter((it) => !known.has(it.key)),
  ];
  unshuffled = null;
  set({
    shuffle: false,
    items: restored,
    index: currentKey ? restored.findIndex((it) => it.key === currentKey) : -1,
  });
}

/** Restore a persisted queue without starting playback (session resume). */
export function seedQueue(
  tracks: Track[],
  index: number,
  opts: { repeat: RepeatMode; radio: boolean; shuffle: boolean; contextTo: string | null },
) {
  const items: QueueItem[] = tracks.map((track) => ({ track, key: synthKey() }));
  set({ items, index, ...opts });
  usePlayerStore.setState({ entryKey: items[index]?.key ?? null });
}

export function next(auto = false) {
  const { items, index, repeat } = get();
  if (repeat === "one" && auto) {
    void playIndex(index);
    return;
  }
  let candidate = index + 1;
  // Skip geo-blocked entries on auto-advance.
  while (candidate < items.length && auto && isBlocked(items[candidate].track)) {
    candidate += 1;
  }
  if (candidate < items.length) {
    void playIndex(candidate);
    return;
  }
  if (repeat === "all" && items.length > 0) {
    void playIndex(0);
    return;
  }
  void extendRadioAndAdvance();
}

export function prev() {
  const { index } = get();
  if (audioController.audio.currentTime > 3 || index <= 0) {
    audioController.seek(0);
    return;
  }
  void playIndex(index - 1);
}

export function toggleRepeat() {
  const order: RepeatMode[] = ["off", "all", "one"];
  const { repeat } = get();
  set({ repeat: order[(order.indexOf(repeat) + 1) % order.length] });
}

export function toggleRadio() {
  set({ radio: !get().radio });
}

export function togglePanel() {
  set({ panelOpen: !get().panelOpen });
}

/** Station mode: top up the queue with related tracks as it nears the end. */
async function maybeExtendRadio() {
  const { items, index, radio, radioLoading, repeat } = get();
  if (!radio || radioLoading || repeat !== "off") return;
  if (index < items.length - 3) return;
  await fetchRelatedInto();
}

async function extendRadioAndAdvance() {
  const { radio, items, index } = get();
  if (!radio) {
    audioController.pause();
    return;
  }
  const added = await fetchRelatedInto();
  if (added > 0 && index + 1 < get().items.length) {
    void playIndex(index + 1);
  } else if (items.length > 0) {
    audioController.pause();
  }
}

async function fetchRelatedInto(): Promise<number> {
  const track = currentTrack();
  if (!track) return 0;
  set({ radioLoading: true });
  try {
    const page = await api.getRelatedTracks(track.id);
    const existing = new Set(get().items.map((it) => it.track.id));
    const fresh = page.collection.filter(
      (t) => !existing.has(t.id) && !isBlocked(t) && !isSnipped(t),
    );
    if (fresh.length > 0) {
      set({ items: [...get().items, ...fresh.map((track) => ({ track, key: synthKey() }))] });
    }
    return fresh.length;
  } catch (e) {
    console.error("radio fetch failed", e);
    return 0;
  } finally {
    set({ radioLoading: false });
  }
}

/** Consecutive play failures before we stop auto-advancing through the queue. */
const MAX_CONSECUTIVE_SKIPS = 3;

// Wire the controller's lifecycle callbacks (single direction import).
audioController.onEnded = () => next(true);
audioController.onUnrecoverable = (failures) => {
  // A one-off failure skips to the next track. But once several fail in a row,
  // the problem is the session (rate limit), not the track — stop advancing so
  // it doesn't blast through the whole queue and the error stays on screen.
  if (failures >= MAX_CONSECUTIVE_SKIPS) return;
  const { items, index } = get();
  if (index + 1 < items.length) next(true);
};
