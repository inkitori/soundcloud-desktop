import { listen } from "@tauri-apps/api/event";
import type { User } from "../api/types";
import { audioController } from "../player/audioController";
import { next, prev } from "../player/queueStore";
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

  void listen<{ track_id: number }>("download:done", (event) => {
    setDownloadProgress(event.payload.track_id, null);
    void refreshDownloads();
  });

  void listen<{ track_id: number; message: string; cancelled: boolean }>(
    "download:error",
    (event) => {
      setDownloadProgress(event.payload.track_id, null);
      if (!event.payload.cancelled) {
        console.error(`download ${event.payload.track_id} failed: ${event.payload.message}`);
        showToast(`Download failed: ${event.payload.message}`, "error");
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
