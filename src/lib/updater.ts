import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { create } from "zustand";
import { showToast } from "./toast";

export type UpdatePhase = "idle" | "checking" | "downloading" | "ready" | "upToDate" | "error";

interface UpdateState {
  phase: UpdatePhase;
  /** Version of the downloaded update, once one is found. */
  version: string | null;
  error: string | null;
}

export const useUpdateStore = create<UpdateState>(() => ({
  phase: "idle",
  version: null,
  error: null,
}));

/**
 * Check GitHub Releases for a newer build; if found, download it right away
 * (install happens atomically on download for macOS) and leave the app
 * running — the new version takes effect on the next launch or via
 * restartToUpdate(). `silent` suppresses errors/toasts for the startup check.
 */
export async function checkForUpdates({ silent }: { silent: boolean }) {
  if (import.meta.env.DEV) return;
  const { phase } = useUpdateStore.getState();
  if (phase === "checking" || phase === "downloading" || phase === "ready") return;

  useUpdateStore.setState({ phase: "checking", error: null });
  try {
    const update = await check();
    if (!update) {
      useUpdateStore.setState({ phase: "upToDate" });
      return;
    }
    useUpdateStore.setState({ phase: "downloading", version: update.version });
    await update.downloadAndInstall();
    useUpdateStore.setState({ phase: "ready" });
    if (silent) {
      showToast(`Update v${update.version} downloaded — restart from Settings to apply`);
    }
  } catch (e) {
    useUpdateStore.setState({ phase: "error", error: String(e) });
    if (!silent) showToast(`Update check failed: ${String(e)}`, "error");
  }
}

export async function restartToUpdate() {
  await relaunch();
}
