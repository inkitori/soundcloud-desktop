import { Link, NavLink } from "react-router-dom";
import { useAuthStore } from "../lib/stores";
import { artwork } from "../lib/format";
import soundcloudLogo from "../assets/soundcloud.png";
import {
  IconDownload,
  IconHeartFilled,
  IconHome,
  IconList,
  IconSearch,
  IconSettings,
  IconUser,
} from "./Icons";

const navItems = [
  { to: "/", label: "Feed", icon: IconHome },
  { to: "/likes", label: "Likes", icon: IconHeartFilled },
  { to: "/playlists", label: "Playlists", icon: IconList },
  { to: "/downloads", label: "Downloads", icon: IconDownload },
  { to: "/search", label: "Search", icon: IconSearch },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? "bg-white/10 text-zinc-50" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
  }`;

export function Sidebar() {
  const me = useAuthStore((s) => s.status?.me);

  return (
    <nav className="flex w-52 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950/60">
      <div className="flex items-center justify-center px-4 py-5">
        <Link to="/" aria-label="Go to feed">
          <img src={soundcloudLogo} alt="Logo" className="h-11 w-11" />
        </Link>
      </div>
      <div className="flex flex-col gap-0.5 px-2">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === "/"} className={linkClass}>
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
        {me && (
          <NavLink to={`/artist/${me.id}`} className={linkClass}>
            {me.avatar_url ? (
              <img src={artwork(me.avatar_url, 120)!} alt="" className="h-5 w-5 rounded-full" />
            ) : (
              <IconUser size={17} />
            )}
            Profile
          </NavLink>
        )}
      </div>
      <div className="mt-auto px-2 pb-4">
        <NavLink to="/settings" className={linkClass}>
          <IconSettings size={17} />
          <span className="truncate">Settings</span>
        </NavLink>
      </div>
    </nav>
  );
}
