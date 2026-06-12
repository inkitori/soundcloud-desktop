import { create } from "zustand";
import type { Track } from "../api/types";

/**
 * App-level modals. `auth` modals interrupt (session expired / bot
 * protection); the playlist ones are user-initiated pickers.
 */
interface ModalState {
  auth: "expired" | "writeBlocked" | null;
  addToPlaylistTrack: Track | null;
  createPlaylistOpen: boolean;
}

export const useModalStore = create<ModalState>(() => ({
  auth: null,
  addToPlaylistTrack: null,
  createPlaylistOpen: false,
}));

export function openAuthModal(kind: "expired" | "writeBlocked") {
  useModalStore.setState({ auth: kind });
}

export function closeAuthModal() {
  useModalStore.setState({ auth: null });
}

export function openAddToPlaylist(track: Track) {
  useModalStore.setState({ addToPlaylistTrack: track });
}

export function closeAddToPlaylist() {
  useModalStore.setState({ addToPlaylistTrack: null });
}

export function openCreatePlaylist() {
  useModalStore.setState({ createPlaylistOpen: true });
}

export function closeCreatePlaylist() {
  useModalStore.setState({ createPlaylistOpen: false });
}
