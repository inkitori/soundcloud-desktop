import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api } from "./api/commands";
import { AuthModals } from "./components/AuthModals";
import { IconCloud, Spinner } from "./components/Icons";
import { PlayerBar } from "./components/PlayerBar";
import { PlaylistModals } from "./components/PlaylistModals";
import { QueuePanel } from "./components/QueuePanel";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { TokenGate } from "./components/TokenGate";
import { TopBar } from "./components/TopBar";
import { initEvents } from "./lib/events";
import { startLogin } from "./lib/login";
import {
  initNetworkWatch,
  loadSocialIds,
  refreshAuth,
  refreshDownloads,
  useAuthStore,
  useNetworkStore,
} from "./lib/stores";
import { checkForUpdates } from "./lib/updater";
import { ArtistPage } from "./pages/ArtistPage";
import { DownloadsPage } from "./pages/DownloadsPage";
import { FeedPage } from "./pages/FeedPage";
import { LikesPage } from "./pages/LikesPage";
import { PlaylistDetailPage } from "./pages/PlaylistDetailPage";
import { PlaylistsPage } from "./pages/PlaylistsPage";
import { SearchPage } from "./pages/SearchPage";
import { discordRpcEnabled, SettingsPage } from "./pages/SettingsPage";
import { Link } from "react-router-dom";

export default function App() {
  const loading = useAuthStore((s) => s.loading);
  const loggedIn = useAuthStore((s) => s.status?.logged_in ?? false);
  const expired = useAuthStore((s) => s.expired);
  const online = useNetworkStore((s) => s.online);

  useEffect(() => {
    initEvents();
    initNetworkWatch();
    void refreshAuth();
    void refreshDownloads();
    // The backend presence actor defaults to enabled; only the opt-out needs replaying.
    if (!discordRpcEnabled()) void api.discordSetEnabled(false);
    void checkForUpdates({ silent: true });
  }, []);

  // Mirror like/repost/follow ids once signed in; delayed so the first
  // screen's requests win the rate limiter.
  useEffect(() => {
    if (!loggedIn) return;
    const t = setTimeout(() => void loadSocialIds(), 3500);
    return () => clearTimeout(t);
  }, [loggedIn]);

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-orange-500">
        <IconCloud size={40} />
        <Spinner size={20} />
      </div>
    );
  }

  if (!loggedIn) {
    return (
      <>
        <TokenGate />
        <Toasts />
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {expired && <ExpiredBanner />}
      {!online && <OfflineBanner />}
      <div className="relative flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <div className="min-h-0 flex-1">
            <Routes>
              <Route path="/" element={<FeedPage />} />
              <Route path="/likes" element={<LikesPage />} />
              <Route path="/playlists" element={<PlaylistsPage />} />
              <Route path="/downloads" element={<DownloadsPage />} />
              <Route path="/playlist/:id" element={<PlaylistDetailPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/artist/:id" element={<ArtistPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
        <QueuePanel />
        <Toasts />
      </div>
      <PlayerBar />
      <AuthModals />
      <PlaylistModals />
    </div>
  );
}

function ExpiredBanner() {
  return (
    <div className="flex shrink-0 items-center justify-center gap-2 bg-amber-600/90 px-4 py-1.5 text-xs font-medium text-white">
      Your SoundCloud session expired —
      <button onClick={() => void startLogin()} className="font-semibold underline">
        sign in again
      </button>
    </div>
  );
}

function OfflineBanner() {
  return (
    <div className="flex shrink-0 items-center justify-center gap-2 bg-zinc-700 px-4 py-1.5 text-xs font-medium text-white">
      You're offline — only downloaded tracks are available.
      <Link to="/downloads" className="font-semibold underline">
        Go to Downloads
      </Link>
    </div>
  );
}
