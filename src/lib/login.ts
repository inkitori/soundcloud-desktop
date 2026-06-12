import { create } from "zustand";
import { api } from "../api/commands";
import type { AppError } from "../api/types";
import { showToast } from "./toast";

/**
 * Embedded sign-in flow. `startLogin` opens the SoundCloud sign-in window;
 * the backend watches its cookies and emits `login:success` / `login:closed`
 * (handled in events.ts), which clear `waiting`.
 */
interface LoginState {
  waiting: boolean;
}

export const useLoginStore = create<LoginState>(() => ({ waiting: false }));

export async function startLogin() {
  useLoginStore.setState({ waiting: true });
  try {
    await api.loginStart();
  } catch (e) {
    useLoginStore.setState({ waiting: false });
    showToast((e as AppError).message ?? String(e), "error");
  }
}

export async function cancelLogin() {
  try {
    await api.loginCancel();
  } finally {
    useLoginStore.setState({ waiting: false });
  }
}
