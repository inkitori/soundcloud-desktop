import { useState } from "react";
import { api } from "../api/commands";
import type { AppError } from "../api/types";
import { cancelLogin, startLogin, useLoginStore } from "../lib/login";
import { refreshAuth } from "../lib/stores";
import { IconCloud, Spinner } from "./Icons";

/**
 * First-run screen. Primary path: the embedded sign-in window (the backend
 * captures the session cookies itself). Manual token paste stays available
 * behind a disclosure as the escape hatch.
 */
export function TokenGate() {
  const waiting = useLoginStore((s) => s.waiting);

  return (
    <div className="flex h-full items-center justify-center bg-zinc-950">
      <div className="w-[26rem] rounded-xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl">
        <div className="mb-2 flex justify-center text-orange-500">
          <IconCloud size={44} />
        </div>
        <h1 className="text-center text-xl font-bold text-zinc-100">SoundCloud Desktop</h1>
        <p className="mt-2 text-center text-sm leading-relaxed text-zinc-400">
          Sign in with your SoundCloud account to get started. A SoundCloud sign-in window will
          open and close by itself once you're in.
        </p>

        {waiting ? (
          <div className="mt-6">
            <div className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-800 py-2.5 text-sm font-semibold text-zinc-300">
              <Spinner size={15} />
              Waiting for sign-in…
            </div>
            <button
              onClick={() => void cancelLogin()}
              className="mt-2 w-full text-center text-xs text-zinc-500 hover:text-zinc-300"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => void startLogin()}
            className="mt-6 w-full rounded-lg bg-orange-600 py-2.5 text-sm font-semibold text-white hover:bg-orange-500"
          >
            Sign in with SoundCloud
          </button>
        )}

        <p className="mt-3 text-center text-xs text-zinc-600">
          Your session is stored in the macOS Keychain, nowhere else.
        </p>

        <details className="mt-5 border-t border-zinc-800 pt-4">
          <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">
            Sign in manually with a token instead
          </summary>
          <ManualTokenForm />
        </details>
      </div>
    </div>
  );
}

function ManualTokenForm() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const cleaned = token.trim().replace(/^OAuth\s+/i, "");
    if (!cleaned) return;
    setBusy(true);
    setError(null);
    try {
      await api.authSetToken(cleaned);
      await refreshAuth();
    } catch (e) {
      const err = e as AppError;
      setError(err.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      <p className="text-xs leading-relaxed text-zinc-500">
        In your browser, log in at <span className="font-mono text-zinc-400">soundcloud.com</span>,
        open DevTools → Application/Storage → Cookies, and copy the{" "}
        <span className="font-mono text-zinc-400">oauth_token</span> value (starts with{" "}
        <span className="font-mono">2-</span>).
      </p>
      <textarea
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="2-XXXXXX-XXXXXXXXX-XXXXXXXXXXXXXX"
        rows={2}
        spellCheck={false}
        className="mt-2 w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 p-2.5 font-mono text-xs text-zinc-100 outline-none focus:border-orange-500"
      />
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      <button
        onClick={() => void submit()}
        disabled={busy || token.trim().length < 10}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/15 disabled:opacity-40"
      >
        {busy && <Spinner size={13} />}
        {busy ? "Checking token…" : "Connect with token"}
      </button>
    </div>
  );
}
