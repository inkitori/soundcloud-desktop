import { useEffect, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { api } from "../api/commands";
import { useCacheStats } from "../api/queries";
import type { AppError } from "../api/types";
import { Spinner } from "../components/Icons";
import { fmtBytes } from "../lib/format";
import { cancelLogin, startLogin, useLoginStore } from "../lib/login";
import { refreshAuth, refreshDownloads, useAuthStore, useDownloadStore } from "../lib/stores";
import { checkForUpdates, restartToUpdate, useUpdateStore } from "../lib/updater";

export function SettingsPage() {
  const me = useAuthStore((s) => s.status?.me);

  return (
    <div className="h-full overflow-y-auto px-6 pb-8">
      <h1 className="py-5 text-lg font-bold text-zinc-100">Settings</h1>
      <div className="max-w-2xl space-y-8">
        <AccountSection username={me?.username} />
        <DiscordSection />
        <CacheSection />
        <UpdatesSection />
      </div>
    </div>
  );
}

function AccountSection({ username }: { username?: string | null }) {
  const datadomeSet = useAuthStore((s) => s.status?.datadome_set ?? false);
  const waiting = useLoginStore((s) => s.waiting);

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-500">
        Account
      </h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <p className="text-sm text-zinc-300">
          Logged in as <span className="font-semibold text-zinc-100">{username ?? "…"}</span>
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Refresh your session if likes stop working or you get signed out.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => void (waiting ? cancelLogin() : startLogin())}
            className="flex items-center gap-2 rounded-md bg-orange-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-orange-500"
          >
            {waiting && <Spinner size={12} />}
            {waiting ? "Waiting — click to cancel" : "Refresh session"}
          </button>
          <button
            onClick={() => {
              void api.authClearToken().then(refreshAuth);
            }}
            className="text-xs text-red-400 hover:underline"
          >
            Disconnect account
          </button>
        </div>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">
          Advanced: set the session cookies manually
        </summary>
        <ManualTokenRow />
        <DatadomeRow configured={datadomeSet} />
      </details>
    </section>
  );
}

function ManualTokenRow() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const updateToken = async () => {
    const cleaned = token.trim().replace(/^OAuth\s+/i, "");
    if (!cleaned) return;
    setBusy(true);
    setMessage(null);
    try {
      const user = await api.authSetToken(cleaned);
      await refreshAuth();
      setToken("");
      setMessage(`Connected as ${user.username}`);
    } catch (e) {
      setMessage((e as AppError).message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <span className="text-sm font-medium text-zinc-200">OAuth token</span>
      <p className="mt-1 text-xs text-zinc-500">
        Copy the <span className="font-mono">oauth_token</span> cookie from your browser (DevTools
        → Application → Cookies → soundcloud.com) and paste it here.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="paste new oauth_token"
          spellCheck={false}
          className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-100 outline-none focus:border-orange-500"
        />
        <button
          onClick={() => void updateToken()}
          disabled={busy || token.trim().length < 10}
          className="flex items-center gap-2 rounded-md bg-white/10 px-4 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/15 disabled:opacity-40"
        >
          {busy && <Spinner size={12} />}
          Update
        </button>
      </div>
      {message && <p className="mt-2 text-xs text-zinc-400">{message}</p>}
    </div>
  );
}

/**
 * SoundCloud guards write requests (likes, playlist edits) with DataDome bot
 * protection, which only clears for a cookie a real browser solved. We can't
 * solve it headlessly, so the user pastes their browser's `datadome` cookie —
 * same place they got `oauth_token`.
 */
function DatadomeRow({ configured }: { configured: boolean }) {
  const [cookie, setCookie] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setBusy(true);
    setSaved(false);
    try {
      await api.authSetDatadome(cookie.trim());
      await refreshAuth();
      setCookie("");
      setSaved(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium text-zinc-200">datadome cookie</span>
        <span className={`text-xs ${configured ? "text-emerald-400" : "text-zinc-500"}`}>
          {configured ? "set" : "not set"}
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        SoundCloud blocks liking and playlist changes from outside the browser with bot protection.
        To enable them, copy the <span className="font-mono">datadome</span> cookie value from your
        browser (DevTools → Application → Cookies → soundcloud.com) and paste it here. It rotates
        over time; re-paste if likes start failing again.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          value={cookie}
          onChange={(e) => setCookie(e.target.value)}
          placeholder="paste datadome cookie"
          spellCheck={false}
          className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-100 outline-none focus:border-orange-500"
        />
        <button
          onClick={() => void save()}
          disabled={busy || cookie.trim().length < 10}
          className="flex items-center gap-2 rounded-md bg-white/10 px-4 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/15 disabled:opacity-40"
        >
          {busy && <Spinner size={12} />}
          Save
        </button>
      </div>
      {saved && <p className="mt-2 text-xs text-zinc-400">Saved — try liking a track.</p>}
    </div>
  );
}

function DiscordSection() {
  const [enabled, setEnabled] = useState(discordRpcEnabled());

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    localStorage.setItem("discordRpc", next ? "1" : "0");
    void api.discordSetEnabled(next);
  };

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-500">
        Discord
      </h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <label className="flex cursor-pointer items-center gap-3">
          <input type="checkbox" checked={enabled} onChange={toggle} className="accent-orange-600" />
          <span className="text-sm text-zinc-300">Show what I'm listening to on Discord</span>
        </label>
        <p className="mt-1 text-xs text-zinc-500">
          Rich Presence with track, artist, artwork and live progress. Needs the Discord desktop
          app running; presence hides while paused.
        </p>
      </div>
    </section>
  );
}

export function discordRpcEnabled(): boolean {
  return localStorage.getItem("discordRpc") !== "0";
}

function UpdatesSection() {
  const { phase, version, error } = useUpdateStore();
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    void getVersion().then(setAppVersion);
  }, []);

  const status = {
    idle: null,
    checking: "Checking…",
    downloading: `Downloading v${version}…`,
    ready: `v${version} downloaded — restart to apply`,
    upToDate: "You're on the latest version.",
    error: error,
  }[phase];

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-500">
        Updates
      </h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <p className="text-sm text-zinc-300">
          SoundCloud Desktop{" "}
          <span className="font-semibold text-zinc-100">{appVersion ?? "…"}</span>
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Updates are checked automatically on launch and downloaded in the background.
        </p>
        <div className="mt-3 flex items-center gap-3">
          {phase === "ready" ? (
            <button
              onClick={() => void restartToUpdate()}
              className="rounded-md bg-orange-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-orange-500"
            >
              Restart to update
            </button>
          ) : (
            <button
              onClick={() => void checkForUpdates({ silent: false })}
              disabled={phase === "checking" || phase === "downloading"}
              className="flex items-center gap-2 rounded-md bg-white/10 px-4 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/15 disabled:opacity-40"
            >
              {(phase === "checking" || phase === "downloading") && <Spinner size={12} />}
              Check for updates
            </button>
          )}
          {status && (
            <span className={`text-xs ${phase === "error" ? "text-red-400" : "text-zinc-400"}`}>
              {status}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

function CacheSection() {
  const { data: stats } = useCacheStats();
  // Select the stable map and derive the array outside the selector: a fresh
  // array per snapshot makes useSyncExternalStore loop and crash the page.
  const cachedMap = useDownloadStore((s) => s.cached);
  const cached = useMemo(() => Object.values(cachedMap), [cachedMap]);
  const [capGb, setCapGb] = useState<string>("");

  const applyCap = async () => {
    const gb = Number(capGb);
    if (!Number.isFinite(gb) || gb <= 0) return;
    await api.setCacheCap(Math.round(gb * 1024 ** 3));
    await refreshDownloads();
    setCapGb("");
  };

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-500">
        Offline cache
      </h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <p className="text-sm text-zinc-300">
          {stats ? (
            <>
              <span className="font-semibold text-zinc-100">{fmtBytes(stats.bytes_used)}</span>{" "}
              used of {fmtBytes(stats.byte_cap)} cap · {stats.count} tracks
            </>
          ) : (
            "…"
          )}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            value={capGb}
            onChange={(e) => setCapGb(e.target.value)}
            placeholder="cap in GB"
            className="w-28 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-orange-500"
          />
          <button
            onClick={() => void applyCap()}
            className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/15"
          >
            Set cap
          </button>
        </div>

        {cached.length > 0 && (
          <div className="mt-4 space-y-1 border-t border-zinc-800 pt-3">
            {cached.map((row) => (
              <div key={row.track_id} className="flex items-center gap-3 text-xs">
                <span className="min-w-0 flex-1 truncate text-zinc-300">
                  {row.title ?? row.track_id}{" "}
                  <span className="text-zinc-600">— {row.artist}</span>
                </span>
                <span className="text-zinc-600">{fmtBytes(row.bytes)}</span>
                <button
                  onClick={() => {
                    void api.removeDownload(row.track_id).then(refreshDownloads);
                  }}
                  className="text-red-400/80 hover:text-red-400"
                >
                  remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
