import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/commands";
import { useMyPlaylists } from "../api/queries";
import type { Playlist, Track } from "../api/types";
import { artwork, trackTitle } from "../lib/format";
import {
  closeAddToPlaylist,
  closeCreatePlaylist,
  useModalStore,
} from "../lib/modals";
import { queryClient } from "../lib/queryClient";
import { handleWriteError, useAuthStore } from "../lib/stores";
import { showToast } from "../lib/toast";
import { IconList, IconPlus, Spinner } from "./Icons";
import { Modal, ModalButton } from "./Modal";

function invalidatePlaylists(playlistId?: number) {
  void queryClient.invalidateQueries({ queryKey: ["my-playlists"] });
  if (playlistId != null) {
    void queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] });
  }
}

export function PlaylistModals() {
  return (
    <>
      <CreatePlaylistModal />
      <AddToPlaylistModal />
    </>
  );
}

function PrivacyToggle({
  isPublic,
  onChange,
}: {
  isPublic: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-zinc-700 text-xs font-semibold">
      {[
        { label: "Public", value: true },
        { label: "Private", value: false },
      ].map(({ label, value }) => (
        <button
          key={label}
          onClick={() => onChange(value)}
          className={`px-3 py-1.5 ${
            isPublic === value
              ? "bg-zinc-100 text-zinc-900"
              : "bg-zinc-950 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function CreatePlaylistModal() {
  const open = useModalStore((s) => s.createPlaylistOpen);
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const create = async () => {
    const name = title.trim();
    if (!name) return;
    setBusy(true);
    try {
      const playlist = await api.createPlaylist(name, isPublic, []);
      invalidatePlaylists();
      closeCreatePlaylist();
      setTitle("");
      showToast(`Created "${name}"`);
      navigate(`/playlist/${playlist.id}`);
    } catch (e) {
      handleWriteError(e, "create playlist");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New playlist" onClose={closeCreatePlaylist}>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void create();
        }}
        placeholder="Playlist title"
        className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-orange-500"
      />
      <div className="mt-3 flex items-center justify-between">
        <PrivacyToggle isPublic={isPublic} onChange={setIsPublic} />
        <div className="flex gap-2">
          <ModalButton onClick={closeCreatePlaylist}>Cancel</ModalButton>
          <ModalButton primary disabled={busy || !title.trim()} onClick={() => void create()}>
            {busy && <Spinner size={12} />}
            Create
          </ModalButton>
        </div>
      </div>
    </Modal>
  );
}

function AddToPlaylistModal() {
  // Mount the inner component only while open so its queries don't fire on
  // app start (this component lives permanently in App).
  const track = useModalStore((s) => s.addToPlaylistTrack);
  if (!track) return null;
  return <AddToPlaylistInner track={track} />;
}

function AddToPlaylistInner({ track }: { track: NonNullable<Track> }) {
  const me = useAuthStore((s) => s.status?.me);
  const playlistsQuery = useMyPlaylists();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [isPublic, setIsPublic] = useState(true);

  // The library endpoint mixes in liked playlists; only own ones are editable.
  const mine = useMemo(() => {
    const all = playlistsQuery.data?.pages.flatMap((p) => p.collection) ?? [];
    return all.filter((p) => p.user?.id === me?.id);
  }, [playlistsQuery.data, me?.id]);

  const close = () => {
    closeAddToPlaylist();
    setCreating(false);
    setTitle("");
  };

  const addTo = async (playlist: Playlist) => {
    setBusyId(playlist.id);
    try {
      await api.playlistAddTrack(playlist.id, track.id);
      invalidatePlaylists(playlist.id);
      showToast(`Added to "${playlist.title ?? "playlist"}"`);
      close();
    } catch (e) {
      handleWriteError(e, "add to playlist");
    } finally {
      setBusyId(null);
    }
  };

  const createWithTrack = async () => {
    const name = title.trim();
    if (!name) return;
    setBusyId(-1);
    try {
      const playlist = await api.createPlaylist(name, isPublic, [track.id]);
      invalidatePlaylists(playlist.id);
      showToast(`Created "${name}"`);
      close();
    } catch (e) {
      handleWriteError(e, "create playlist");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal title={`Add "${trackTitle(track)}" to playlist`} onClose={close}>
      {creating ? (
        <div>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createWithTrack();
            }}
            placeholder="Playlist title"
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-orange-500"
          />
          <div className="mt-3 flex items-center justify-between">
            <PrivacyToggle isPublic={isPublic} onChange={setIsPublic} />
            <div className="flex gap-2">
              <ModalButton onClick={() => setCreating(false)}>Back</ModalButton>
              <ModalButton
                primary
                disabled={busyId != null || !title.trim()}
                onClick={() => void createWithTrack()}
              >
                {busyId === -1 && <Spinner size={12} />}
                Create
              </ModalButton>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-0.5">
          <button
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm font-medium text-zinc-100 hover:bg-white/5"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded bg-white/5 text-zinc-300">
              <IconPlus size={16} />
            </span>
            New playlist
          </button>
          {playlistsQuery.isLoading && (
            <div className="flex justify-center py-4 text-zinc-500">
              <Spinner />
            </div>
          )}
          {mine.map((p) => (
            <button
              key={p.id}
              onClick={() => void addTo(p)}
              disabled={busyId != null}
              className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-white/5 disabled:opacity-50"
            >
              <span className="h-10 w-10 shrink-0 overflow-hidden rounded bg-zinc-800">
                {artwork(p.artwork_url ?? p.tracks[0]?.artwork_url, 120) ? (
                  <img
                    src={artwork(p.artwork_url ?? p.tracks[0]?.artwork_url, 120)!}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-zinc-600">
                    <IconList size={16} />
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-zinc-100">
                  {p.title ?? "Untitled"}
                </span>
                <span className="block text-xs text-zinc-500">
                  {p.track_count ?? p.tracks.length} tracks
                </span>
              </span>
              {busyId === p.id && <Spinner size={14} className="text-zinc-400" />}
            </button>
          ))}
          {!playlistsQuery.isLoading && mine.length === 0 && (
            <p className="px-2 py-3 text-xs text-zinc-500">
              You don't have any playlists yet — create one above.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
