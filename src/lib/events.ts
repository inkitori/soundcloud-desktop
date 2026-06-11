import { listen } from "@tauri-apps/api/event";
import { audioController } from "../player/audioController";
import { next, prev } from "../player/queueStore";
import { refreshDownloads, setDownloadProgress, useAuthStore } from "./stores";

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
    useAuthStore.setState({ expired: true });
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
    }
  });
}
