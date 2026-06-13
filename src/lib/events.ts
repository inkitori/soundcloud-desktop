import { listen } from "@tauri-apps/api/event";
import type { User } from "../api/types";
import { audioController } from "../player/audioController";
import { next, prev } from "../player/queueStore";
import { isUnavailableCode, settleBatchTrack } from "./downloads";
import { useLoginStore } from "./login";
import { closeAuthModal, openAuthModal } from "./modals";
import {
  loadSocialIds,
  refreshAuth,
  refreshDownloads,
  setDownloadProgress,
  useAuthStore,
} from "./stores";
import { showToast } from "./toast";

let initialized = false;

/** Wire Rust → webview events once (guarded against StrictMode re-runs). */
export function initEvents() {
  if (initialized) return;
  initialized = true;

  void listen<{ action: string; position_s?: number }>("media:cmd", (event) => {
    const { action, position_s } = event.payload;
    switch (action) {
      case "play":
        void audioController.play();
        break;
      case "pause":
        audioController.pause();
        break;
      case "toggle":
        audioController.toggle();
        break;
      case "next":
        next();
        break;
      case "prev":
        prev();
        break;
      case "seek":
        if (position_s != null) audioController.seek(position_s);
        break;
    }
  });

  void listen("auth:expired", () => {
    // Only interrupt once per expiry; the banner stays as the reminder.
    if (!useAuthStore.getState().expired) openAuthModal("expired");
    useAuthStore.setState({ expired: true });
  });

  void listen<User>("login:success", (event) => {
    useLoginStore.setState({ waiting: false });
    closeAuthModal();
    useAuthStore.setState({ expired: false });
    void refreshAuth();
    void loadSocialIds(true);
    showToast(`Signed in as ${event.payload.username ?? "you"}`);
  });

  void listen("login:closed", () => {
    useLoginStore.setState({ waiting: false });
  });

  void listen<{ track_id: number; pct: number }>("download:progress", (event) => {
    setDownloadProgress(event.payload.track_id, event.payload.pct);
  });

  void listen<{ track_id: number; bytes: number; evicted: number[] }>("download:done", (event) => {
    setDownloadProgress(event.payload.track_id, null);
    settleBatchTrack(event.payload.track_id, true);
    void refreshDownloads();
    const evicted = event.payload.evicted?.length ?? 0;
    if (evicted > 0) {
      showToast(`Freed space: removed ${evicted} least-played ${evicted === 1 ? "track" : "tracks"}`);
    }
  });

  void listen<{ track_id: number; message: string; code?: string; cancelled: boolean }>(
    "download:error",
    (event) => {
      setDownloadProgress(event.payload.track_id, null);
      // A batch rolls failures into one summary; only lone downloads toast here.
      const batched = settleBatchTrack(event.payload.track_id, false, event.payload.code);
      if (event.payload.cancelled) return;
      console.error(`download ${event.payload.track_id} failed: ${event.payload.message}`);
      if (!batched) {
        // Go+/DRM tracks aren't a failure to retry — say so plainly.
        const prefix = isUnavailableCode(event.payload.code) ? "Can't download" : "Download failed";
        showToast(`${prefix}: ${event.payload.message}`, "error");
      }
    },
  );

  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable;
    if (typing) return;
    if (e.code === "Space") {
      e.preventDefault();
      audioController.toggle();
    } else if (e.code === "ArrowRight" && e.shiftKey) {
      next();
    } else if (e.code === "ArrowLeft" && e.shiftKey) {
      prev();
    } else if (e.metaKey && e.key === "[") {
      window.history.back();
    } else if (e.metaKey && e.key === "]") {
      window.history.forward();
    }
  });

  // The webview doesn't handle mouse back/forward buttons itself.
  window.addEventListener("mouseup", (e) => {
    if (e.button === 3) window.history.back();
    else if (e.button === 4) window.history.forward();
  });
}
