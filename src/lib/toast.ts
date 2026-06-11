import { create } from "zustand";

interface Toast {
  id: number;
  message: string;
  kind: "info" | "error";
}

interface ToastState {
  toasts: Toast[];
}

export const useToastStore = create<ToastState>(() => ({ toasts: [] }));

let nextId = 0;

export function showToast(message: string, kind: "info" | "error" = "info") {
  const id = ++nextId;
  useToastStore.setState((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
  setTimeout(() => {
    useToastStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  }, kind === "error" ? 5000 : 2500);
}
