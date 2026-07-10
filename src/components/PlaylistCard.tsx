import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Playlist } from "../api/types";
import { artwork } from "../lib/format";
import { playPlaylist } from "../player/playPlaylist";
import { IconList, IconPlay, Spinner } from "./Icons";

export function PlaylistCard({ playlist }: { playlist: Playlist }) {
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const art = artwork(
    playlist.artwork_url ?? playlist.tracks[0]?.artwork_url ?? playlist.user?.avatar_url,
    200,
  );
  return (
    <Link
      to={`/playlist/${playlist.id}`}
      className="group w-40 shrink-0 rounded-lg p-2 transition-colors hover:bg-white/5"
    >
      <div className="relative mb-2 aspect-square w-full overflow-hidden rounded-md bg-zinc-800">
        {art ? (
          <img src={art} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-zinc-600">
            <IconList size={32} />
          </div>
        )}
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setBusy(true);
            void playPlaylist(playlist).finally(() => setBusy(false));
          }}
          className={`absolute bottom-2 left-2 flex h-9 w-9 items-center justify-center rounded-full bg-orange-600 text-white shadow-lg transition-opacity hover:bg-orange-500 ${
            busy ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
          title="Play"
        >
          {busy ? <Spinner size={14} /> : <IconPlay size={16} />}
        </button>
      </div>
      <div className="truncate text-sm font-medium text-zinc-100">
        {playlist.title ?? "Untitled"}
      </div>
      <div className="truncate text-xs text-zinc-500">
        {playlist.user ? (
          // The whole card is a Link, so the artist is a nested click target
          // (a real nested <a> would be invalid HTML).
          <span
            role="link"
            tabIndex={0}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              navigate(`/artist/${playlist.user!.id}`);
            }}
            className="hover:text-zinc-300 hover:underline"
          >
            {playlist.user.username}
          </span>
        ) : null}
        {playlist.user ? " · " : ""}
        {playlist.track_count ?? playlist.tracks.length} tracks
      </div>
    </Link>
  );
}
