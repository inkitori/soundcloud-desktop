import { api } from "../api/commands";
import type { Track } from "../api/types";
import { isBlocked, isSnipped } from "./format";
import { setDownloadProgress, useDownloadStore } from "./stores";
import { showToast } from "./toast";

/**
 * Download orchestration shared by the per-row button and the "Download all"
 * actions. Batch jobs are tracked so their per-track failures roll up into one
 * summary toast instead of spamming one toast per track, and so the row buttons
 * show a pending spinner the moment a job is queued (before the backend, which
 * caps concurrency, actually starts each track).
 */

interface Batch {
  label: string;
  total: number;
  remaining: Set<number>;
  ok: number;
  failed: number;
  unavailable: number;
  skipped: number;
}

const trackToBatch = new Map<number, Batch>();

/** Error codes that mean "this track can't be downloaded on a free account"
 * (Go+ preview-only or DRM/encrypted) — not a real failure to retry. */
const UNAVAILABLE_CODES = new Set(["preview_only", "drm", "no_stream"]);

export function isUnavailableCode(code?: string): boolean {
  return code != null && UNAVAILABLE_CODES.has(code);
}

/** Kick a single download with instant button feedback (optimistic 0%). */
export function startDownload(trackId: number) {
  setDownloadProgress(trackId, 0);
  void api.downloadTrack(trackId, true).catch((e) => {
    setDownloadProgress(trackId, null);
    showToast(`Couldn't start download: ${String((e as Error)?.message ?? e)}`, "error");
  });
}

/**
 * Download every downloadable track in `tracks`, skipping ones that are already
 * cached or can't be downloaded (geo-blocked, Go+ preview-only). Reports a
 * summary when the whole batch settles.
 */
export async function downloadTracks(tracks: Track[], label: string) {
  const cached = useDownloadStore.getState().cached;
  const progress = useDownloadStore.getState().progress;
  const candidates: number[] = [];
  let skipped = 0;
  const seen = new Set<number>();
  for (const t of tracks) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    if (t.id in cached || t.id in progress || trackToBatch.has(t.id)) {
      skipped += 1; // already downloaded or in flight
      continue;
    }
    if (isBlocked(t) || isSnipped(t)) {
      skipped += 1; // geo-blocked or Go+ preview-only
      continue;
    }
    candidates.push(t.id);
  }

  if (candidates.length === 0) {
    showToast(
      skipped > 0
        ? `Nothing new to download from ${label} (already saved or unavailable)`
        : `Nothing to download from ${label}`,
    );
    return;
  }

  const batch: Batch = {
    label,
    total: candidates.length,
    remaining: new Set(candidates),
    ok: 0,
    failed: 0,
    unavailable: 0,
    skipped,
  };
  for (const id of candidates) {
    trackToBatch.set(id, batch);
    setDownloadProgress(id, 0); // show queued spinner immediately
  }
  showToast(`Downloading ${candidates.length} track${candidates.length === 1 ? "" : "s"} from ${label}…`);

  try {
    await api.downloadMany(candidates, true);
  } catch (e) {
    for (const id of candidates) {
      trackToBatch.delete(id);
      setDownloadProgress(id, null);
    }
    showToast(`Couldn't start downloads: ${String((e as Error)?.message ?? e)}`, "error");
  }
}

/**
 * Record a download outcome against any batch it belongs to. Returns true if it
 * was part of a batch (so the caller suppresses the individual failure toast).
 */
export function settleBatchTrack(trackId: number, ok: boolean, code?: string): boolean {
  const batch = trackToBatch.get(trackId);
  if (!batch) return false;
  trackToBatch.delete(trackId);
  batch.remaining.delete(trackId);
  if (ok) batch.ok += 1;
  else if (isUnavailableCode(code)) batch.unavailable += 1;
  else batch.failed += 1;
  if (batch.remaining.size === 0) {
    const parts = [`${batch.ok} downloaded`];
    if (batch.unavailable) parts.push(`${batch.unavailable} unavailable (Go+/DRM)`);
    if (batch.failed) parts.push(`${batch.failed} failed`);
    if (batch.skipped) parts.push(`${batch.skipped} skipped`);
    showToast(`${batch.label}: ${parts.join(", ")}`, batch.failed ? "error" : "info");
  }
  return true;
}
