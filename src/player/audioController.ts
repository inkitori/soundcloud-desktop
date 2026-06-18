import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "../api/commands";
import type { Track } from "../api/types";
import { trackArt, trackArtist, trackTitle } from "../lib/format";
import { showToast } from "../lib/toast";
import { usePlayerStore } from "./playerStore";

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 3000, 8000];
/** Retries for an initial click before the track is declared unplayable. */
const INITIAL_PLAY_RETRIES = 2;
/** Re-resolve before resuming if the signed URL is within a minute of expiry. */
const EXPIRY_MARGIN_MS = 60_000;
/** Watchdog: currentTime frozen this long while "playing" triggers recovery. */
const FROZEN_TICKS_LIMIT = 2; // x 2s interval = 4s

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Singleton owner of the <audio> element. Streaming URLs are signed and
 * expire, so every (re)load resolves a fresh source through Rust, and a
 * layered watchdog (error events + frozen-clock detection) re-resolves and
 * seek-restores mid-track when the CDN cuts us off.
 */
class AudioController {
  readonly audio = new Audio();
  private loadSeq = 0;
  private currentTrack: Track | null = null;
  private expiresAt: number | null = null;
  private retries = 0;
  private recovering = false;
  private lastWatchTime = -1;
  private frozenTicks = 0;
  /** Plays that failed (after retries) back-to-back; reset on any success. */
  private consecutiveFailures = 0;

  /** Wired by queueStore to avoid an import cycle. */
  onEnded: () => void = () => {};
  onUnrecoverable: (failures: number) => void = () => {};

  constructor() {
    const audio = this.audio;
    audio.preload = "auto";
    audio.volume = usePlayerStore.getState().volume;

    audio.addEventListener("timeupdate", () => {
      // While a new track is resolving, the previous element can still emit a
      // stray timeupdate — ignore it so the bar doesn't show the old position.
      if (usePlayerStore.getState().status === "loading") return;
      usePlayerStore.setState({ position: audio.currentTime });
    });
    audio.addEventListener("durationchange", () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        usePlayerStore.setState({ duration: audio.duration });
      }
    });
    audio.addEventListener("play", () => {
      usePlayerStore.setState({ status: "playing" });
      void api.npSetPlayback(true, audio.currentTime);
    });
    audio.addEventListener("pause", () => {
      const { status } = usePlayerStore.getState();
      if (status === "playing") {
        usePlayerStore.setState({ status: "paused" });
      }
      void api.npSetPlayback(false, audio.currentTime);
    });
    audio.addEventListener("ended", () => {
      this.onEnded();
    });
    audio.addEventListener("error", () => {
      if (this.currentTrack && !this.recovering) {
        void this.recover();
      }
    });

    setInterval(() => this.watchdogTick(), 2000);
  }

  private watchdogTick() {
    const { status } = usePlayerStore.getState();
    const audio = this.audio;
    if (status !== "playing" || audio.paused || audio.ended) {
      this.frozenTicks = 0;
      this.lastWatchTime = -1;
      return;
    }
    void api.npSetPlayback(true, audio.currentTime);
    if (audio.currentTime === this.lastWatchTime) {
      this.frozenTicks += 1;
      if (this.frozenTicks >= FROZEN_TICKS_LIMIT && !this.recovering) {
        this.frozenTicks = 0;
        void this.recover();
      }
    } else {
      this.frozenTicks = 0;
    }
    this.lastWatchTime = audio.currentTime;
  }

  async playTrack(track: Track) {
    const seq = ++this.loadSeq;
    this.currentTrack = track;
    this.retries = 0;
    this.recovering = false;
    // Stop the previous track immediately so it doesn't keep playing (or paint
    // the bar) during the async resolve of the new one.
    this.audio.pause();
    usePlayerStore.setState({
      track,
      status: "loading",
      position: 0,
      duration: (track.duration ?? 0) / 1000,
      sourceKind: null,
      snipped: false,
      error: null,
    });
    void api.npSetMetadata(
      trackTitle(track),
      trackArtist(track),
      trackArt(track, 500),
      (track.duration ?? 0) / 1000,
      track.permalink_url ?? null,
    );
    // Transient failures (rate limits, a stale signed URL) are common on a
    // click; retry with backoff and a forced re-resolve before giving up.
    for (let attempt = 0; ; attempt++) {
      try {
        await this.setSource(attempt > 0);
        if (seq !== this.loadSeq) return; // superseded by a newer playTrack
        await this.audio.play();
        if (seq !== this.loadSeq) return;
        this.consecutiveFailures = 0;
        void api.notePlayed(track.id);
        return;
      } catch (e) {
        if (seq !== this.loadSeq) return;
        if (attempt < INITIAL_PLAY_RETRIES) {
          const delay = RETRY_DELAYS_MS[attempt] ?? 8000;
          console.warn(
            `play attempt ${attempt + 1} for ${track.id} failed; retrying in ${delay}ms`,
            e,
          );
          await sleep(delay);
          if (seq !== this.loadSeq) return;
          continue;
        }
        console.error("playTrack failed", e);
        this.giveUp(track, errMessage(e));
        return;
      }
    }
  }

  /** Mark the current track unplayable, surface it, and let the queue react. */
  private giveUp(track: Track, reason: string) {
    this.consecutiveFailures += 1;
    usePlayerStore.setState({ status: "error", error: reason });
    showToast(`Couldn't play "${trackTitle(track)}" — ${reason}`, "error");
    this.onUnrecoverable(this.consecutiveFailures);
  }

  private async setSource(forceRefresh: boolean) {
    const track = this.currentTrack;
    if (!track) throw new Error("no current track");
    const source = await api.getPlaybackSource(track, forceRefresh);
    if (source.kind === "cached") {
      this.audio.src = convertFileSrc(source.asset_path);
      this.expiresAt = null;
      usePlayerStore.setState({ sourceKind: "cached" });
    } else {
      this.audio.src = source.url;
      this.expiresAt = source.expires_at ?? null;
      usePlayerStore.setState({ sourceKind: "stream", snipped: source.snipped });
    }
    this.audio.load();
  }

  private waitForLoaded(timeoutMs = 10_000): Promise<void> {
    const audio = this.audio;
    if (audio.readyState >= 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("media load timeout"));
      }, timeoutMs);
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("media load error"));
      };
      const cleanup = () => {
        clearTimeout(timer);
        audio.removeEventListener("loadedmetadata", onLoaded);
        audio.removeEventListener("error", onError);
      };
      audio.addEventListener("loadedmetadata", onLoaded);
      audio.addEventListener("error", onError);
    });
  }

  /** Re-resolve the stream and restore position after a mid-play failure. */
  private async recover() {
    const track = this.currentTrack;
    if (!track || this.recovering) return;
    if (this.retries >= MAX_RETRIES) {
      this.giveUp(track, "playback failed after retries");
      return;
    }
    this.recovering = true;
    const resumeAt = this.audio.currentTime;
    const delay = RETRY_DELAYS_MS[this.retries] ?? 8000;
    this.retries += 1;
    console.warn(`recovering playback for ${track.id} (attempt ${this.retries}) at ${resumeAt}s`);
    try {
      await sleep(delay);
      if (this.currentTrack?.id !== track.id) return;
      await this.setSource(true);
      await this.waitForLoaded();
      if (resumeAt > 0) this.audio.currentTime = resumeAt;
      await this.audio.play();
      this.retries = 0;
    } catch (e) {
      console.error("recovery attempt failed", e);
      this.recovering = false;
      void this.recover();
      return;
    } finally {
      this.recovering = false;
    }
  }

  async play() {
    // Preemptive refresh: a long pause can outlive the signed URL.
    if (
      this.currentTrack &&
      usePlayerStore.getState().sourceKind === "stream" &&
      this.expiresAt != null &&
      Date.now() > this.expiresAt - EXPIRY_MARGIN_MS
    ) {
      const resumeAt = this.audio.currentTime;
      try {
        await this.setSource(true);
        await this.waitForLoaded();
        if (resumeAt > 0) this.audio.currentTime = resumeAt;
      } catch (e) {
        console.error("preemptive refresh failed", e);
      }
    }
    try {
      await this.audio.play();
    } catch (e) {
      console.error("play failed", e);
    }
  }

  pause() {
    this.audio.pause();
  }

  toggle() {
    const { status } = usePlayerStore.getState();
    if (status === "playing") {
      this.pause();
    } else if (status === "paused" || status === "error") {
      void this.play();
    }
  }

  seek(seconds: number) {
    if (Number.isFinite(seconds)) {
      this.audio.currentTime = Math.max(0, seconds);
      usePlayerStore.setState({ position: this.audio.currentTime });
      void api.npSetPlayback(!this.audio.paused, this.audio.currentTime);
    }
  }

  setVolume(volume: number) {
    const v = Math.min(1, Math.max(0, volume));
    this.audio.volume = v;
    usePlayerStore.setState({ volume: v });
    localStorage.setItem("volume", String(v));
  }

  stop() {
    this.loadSeq += 1;
    this.currentTrack = null;
    this.audio.pause();
    this.audio.removeAttribute("src");
    usePlayerStore.setState({ track: null, status: "idle", position: 0, duration: 0 });
  }
}

function errMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as Error).message);
  return String(e);
}

export const audioController = new AudioController();
