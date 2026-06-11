import { NavLink } from "react-router-dom";
import { useAuthStore } from "../lib/stores";
import { artwork } from "../lib/format";
import { IconCloud, IconHeartFilled, IconHome, IconList, IconSearch, IconSettings } from "./Icons";

const navItems = [
  { to: "/", label: "Feed", icon: IconHome },
  { to: "/likes", label: "Likes", icon: IconHeartFilled },
  { to: "/playlists", label: "Playlists", icon: IconList },
  { to: "/search", label: "Search", icon: IconSearch },
];

export function Sidebar() {
  const me = useAuthStore((s) => s.status?.me);

  return (
    <nav className="flex w-52 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950/60">
      <div className="flex items-center gap-2 px-4 py-5 text-orange-500">
        <IconCloud size={26} />
        <span className="text-base font-bold tracking-tight text-zinc-100">SoundCloud</span>
      </div>
      <div className="flex flex-col gap-0.5 px-2">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-white/10 text-zinc-50"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              }`
            }
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </div>
      <div className="mt-auto px-2 pb-4">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
              isActive ? "bg-white/10 text-zinc-50" : "text-zinc-400 hover:bg-white/5"
            }`
          }
        >
          {me?.avatar_url ? (
            <img src={artwork(me.avatar_url, 120)!} alt="" className="h-5 w-5 rounded-full" />
          ) : (
            <IconSettings size={17} />
          )}
          <span className="truncate">{me?.username ?? "Settings"}</span>
        </NavLink>
      </div>
    </nav>
  );
}
