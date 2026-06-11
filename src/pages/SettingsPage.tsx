import { useState } from "react";
import { api } from "../api/commands";
import { useCacheStats } from "../api/queries";
import type { AppError } from "../api/types";
import { Spinner } from "../components/Icons";
import { fmtBytes } from "../lib/format";
import { refreshAuth, refreshDownloads, useAuthStore, useDownloadStore } from "../lib/stores";

export function SettingsPage() {
  const me = useAuthStore((s) => s.status?.me);

  return (
    <div className="h-full overflow-y-auto px-6 pb-8">
      <h1 className="py-5 text-lg font-bold text-zinc-100">Settings</h1>
      <div className="max-w-2xl space-y-8">
        <AccountSection username={me?.username} />
        <DiscordSection />
        <CacheSection />
      </div>
    </div>
  );
}

function AccountSection({ username }: { username?: string | null }) {
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
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-500">
        Account
      </h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <p className="text-sm text-zinc-300">
          Logged in as <span className="font-semibold text-zinc-100">{username ?? "…"}</span>
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          If SoundCloud says the token expired, copy a fresh{" "}
          <span className="font-mono">oauth_token</span> cookie from your browser and paste it
          here.
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
            className="flex items-center gap-2 rounded-md bg-orange-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-40"
          >
            {busy && <Spinner size={12} />}
            Update
          </button>
        </div>
        {message && <p className="mt-2 text-xs text-zinc-400">{message}</p>}
        <button
          onClick={() => {
            void api.authClearToken().then(refreshAuth);
          }}
          className="mt-4 text-xs text-red-400 hover:underline"
        >
          Disconnect account
        </button>
      </div>
    </section>
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

function CacheSection() {
  const { data: stats } = useCacheStats();
  const cached = useDownloadStore((s) => Object.values(s.cached));
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
