import { useState } from "react";
import { api } from "../api/commands";
import type { AppError } from "../api/types";
import { refreshAuth } from "../lib/stores";
import { IconCloud, Spinner } from "./Icons";

/** First-run screen: walks through copying the OAuth token from the browser. */
export function TokenGate() {
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
    <div className="flex h-full items-center justify-center bg-zinc-950">
      <div className="w-[34rem] rounded-xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-3 text-orange-500">
          <IconCloud size={32} />
          <h1 className="text-xl font-bold text-zinc-100">Connect your SoundCloud account</h1>
        </div>

        <ol className="mb-6 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-zinc-300">
          <li>
            Open <span className="font-mono text-zinc-100">soundcloud.com</span> in your browser
            and make sure you're logged in.
          </li>
          <li>
            Open DevTools (<kbd className="rounded bg-zinc-800 px-1">⌘⌥I</kbd>) →{" "}
            <strong>Storage</strong> tab (Firefox) or <strong>Application</strong> tab (Chrome) →{" "}
            <strong>Cookies</strong> → <span className="font-mono">https://soundcloud.com</span>.
          </li>
          <li>
            Find the cookie named <span className="font-mono text-zinc-100">oauth_token</span> and
            copy its value (it starts with <span className="font-mono">2-</span>).
          </li>
          <li>Paste it below. It's stored in your macOS Keychain, nowhere else.</li>
        </ol>

        <textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="2-XXXXXX-XXXXXXXXX-XXXXXXXXXXXXXX"
          rows={2}
          spellCheck={false}
          className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 p-3 font-mono text-sm text-zinc-100 outline-none focus:border-orange-500"
        />

        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

        <button
          onClick={() => void submit()}
          disabled={busy || token.trim().length < 10}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 py-2.5 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-40"
        >
          {busy && <Spinner size={15} />}
          {busy ? "Checking token…" : "Connect"}
        </button>

        <p className="mt-4 text-xs leading-relaxed text-zinc-500">
          Alternative: DevTools → Network tab → filter "api-v2" → any request →{" "}
          <span className="font-mono">authorization</span> header — copy everything after "OAuth ".
          Tokens occasionally expire; the app will ask you to paste a fresh one when that happens.
        </p>
      </div>
    </div>
  );
}
