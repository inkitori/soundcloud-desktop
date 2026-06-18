import { create } from "zustand";

/** Open/closed state for the ⌘K quick-search overlay. */
interface CommandPaletteState {
  open: boolean;
}

export const useCommandPalette = create<CommandPaletteState>(() => ({ open: false }));

export function openCommandPalette() {
  useCommandPalette.setState({ open: true });
}

export function closeCommandPalette() {
  useCommandPalette.setState({ open: false });
}

export function toggleCommandPalette() {
  useCommandPalette.setState((s) => ({ open: !s.open }));
}
