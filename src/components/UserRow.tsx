import { Link } from "react-router-dom";
import type { User } from "../api/types";
import { artwork, fmtCount } from "../lib/format";
import { toggleFollowUser, useAuthStore, useSocialStore } from "../lib/stores";
import { openUserMenu } from "./ContextMenu";

/** A user in a list (search results, followers/following) with a follow toggle. */
export function UserRow({ user }: { user: User }) {
  const me = useAuthStore((s) => s.status?.me);
  const following = useSocialStore((s) => s.followedUsers.has(user.id));
  const isMe = me?.id === user.id;

  return (
    <Link
      to={`/artist/${user.id}`}
      onContextMenu={(e) => {
        e.preventDefault();
        openUserMenu(e, user);
      }}
      className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-white/5"
    >
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-zinc-800">
        {user.avatar_url && (
          <img
            src={artwork(user.avatar_url, 120)!}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-zinc-100">{user.username}</div>
        <div className="text-xs text-zinc-500">
          {fmtCount(user.followers_count)} followers · {fmtCount(user.track_count)} tracks
        </div>
      </div>
      {!isMe && (
        <button
          onClick={(e) => {
            e.preventDefault();
            void toggleFollowUser(user.id, user.username);
          }}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
            following
              ? "border border-zinc-600 text-zinc-200 hover:border-zinc-400"
              : "bg-orange-600 text-white hover:bg-orange-500"
          }`}
        >
          {following ? "Following" : "Follow"}
        </button>
      )}
    </Link>
  );
}
