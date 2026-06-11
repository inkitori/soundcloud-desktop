import type { Track } from "../api/types";

export function fmtDurationMs(ms?: number | null): string {
  if (!ms || ms <= 0) return "–:––";
  return fmtTime(ms / 1000);
}

export function fmtTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

export function fmtBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function fmtCount(n?: number | null): string {
  if (n == null) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** SoundCloud artwork URLs embed their size: swap "-large" for bigger ones. */
export function artwork(url: string | null | undefined, size: 120 | 200 | 500): string | null {
  if (!url) return null;
  return url.replace("-large.", `-t${size}x${size}.`);
}

export function trackArt(track: Track, size: 120 | 200 | 500): string | null {
  return artwork(track.artwork_url ?? track.user?.avatar_url, size);
}

export function trackArtist(track: Track): string {
  return track.user?.username ?? "Unknown artist";
}

export function trackTitle(track: Track): string {
  return track.title ?? `Track ${track.id}`;
}

export function isBlocked(track: Track): boolean {
  return track.policy === "BLOCK";
}

export function isSnipped(track: Track): boolean {
  return track.policy === "SNIP";
}
