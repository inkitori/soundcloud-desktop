import { Link } from "react-router-dom";
import type { Playlist } from "../api/types";
import { artwork } from "../lib/format";
import { IconList } from "./Icons";

export function PlaylistCard({ playlist }: { playlist: Playlist }) {
  const art = artwork(
    playlist.artwork_url ?? playlist.tracks[0]?.artwork_url ?? playlist.user?.avatar_url,
    200,
  );
  return (
    <Link
      to={`/playlist/${playlist.id}`}
      className="group w-40 shrink-0 rounded-lg p-2 transition-colors hover:bg-white/5"
    >
      <div className="mb-2 aspect-square w-full overflow-hidden rounded-md bg-zinc-800">
        {art ? (
          <img src={art} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-zinc-600">
            <IconList size={32} />
          </div>
        )}
      </div>
      <div className="truncate text-sm font-medium text-zinc-100">
        {playlist.title ?? "Untitled"}
      </div>
      <div className="truncate text-xs text-zinc-500">
        {playlist.user?.username} · {playlist.track_count ?? playlist.tracks.length} tracks
      </div>
    </Link>
  );
}
