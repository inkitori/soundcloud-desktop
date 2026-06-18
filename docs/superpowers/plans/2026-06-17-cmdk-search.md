# Cmd+K Quick-Search Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Spotify-style `⌘K` / `Ctrl+K` quick-search overlay that shows mixed top results (tracks, artists, playlists) and is fully keyboard-drivable, without leaving the current page.

**Architecture:** A Zustand store holds open/closed state. A `CommandPalette` component (rendered once at the app root) reuses the existing `useSearchTracks/Users/Playlists` infinite-query hooks, sliced to the top few of page 1, and renders a floating panel with keyboard navigation. A global keydown handler in `events.ts` toggles the store. The existing `/search` page is taught to read a `?q=` param so the overlay's "Show all" can deep-link into it. No backend changes.

**Tech Stack:** React 19, React Router v7 (HashRouter), Zustand, TanStack Query, Tailwind CSS v4, TypeScript, Tauri 2.

---

## Testing note (read first)

This project has **no test runner** — `package.json` has no `test` script and there is no test harness. Classic red/green TDD is therefore not available, and the approved spec scoped out adding one (a jsdom + testing-library setup for a keyboard/DOM-heavy overlay is a large detour the user did not ask for). The verification gate for every task is:

1. **`pnpm build`** — runs `tsc -b` then `vite build`; this is the automated type-check that catches signature/type/import errors. **Expected: exits 0, no TS errors.**
2. **Manual smoke test** in `pnpm tauri dev` for tasks that change runtime behavior, with the exact steps listed per task.

If a manual step can't be verified (e.g. no search results returned for a query), say so explicitly rather than claiming success.

One small refinement vs. the spec: the first result row is **preselected** (highlighted) when results load — this matches the approved mockup (the `▸` sat on the first track). "Show all results" is the last row, reachable by arrowing down or clicking. So `↵` always activates the highlighted row; the spec's "nothing highlighted → show all" case simply never occurs.

## File structure

- **Create** `src/lib/commandPalette.ts` — Zustand open/close/toggle store (mirrors `lib/modals.ts`).
- **Create** `src/components/CommandPalette.tsx` — the overlay UI, search wiring, keyboard nav.
- **Modify** `src/lib/events.ts` — add the global `⌘/Ctrl+K` toggle.
- **Modify** `src/App.tsx` — render `<CommandPalette />` at the app root.
- **Modify** `src/pages/SearchPage.tsx` — read `?q=` from the URL for deep-linking.

---

## Task 1: Command-palette store

**Files:**
- Create: `src/lib/commandPalette.ts`

- [ ] **Step 1: Create the store**

Create `src/lib/commandPalette.ts` with this exact content:

```ts
import { create } from "zustand";

/** Open/closed state for the ⌘K quick-search overlay. */
interface CommandPaletteState {
  open: boolean;
}

export const useCommandPalette = create<CommandPaletteState>(() => ({ open: false }));

export function openCommandPalette() {
  useCommandPalette.setState({ open: true });
}

export function closeCommandPalette() {
  useCommandPalette.setState({ open: false });
}

export function toggleCommandPalette() {
  useCommandPalette.setState((s) => ({ open: !s.open }));
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm build`
Expected: exits 0, no TypeScript errors. (The new file isn't imported yet, but it must compile.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/commandPalette.ts
git commit -m "feat(search): add command-palette open/close store"
```

---

## Task 2: CommandPalette component + wire into app + ⌘K shortcut

This task produces the full working overlay: pressing `⌘K` opens a floating panel, typing shows mixed top results, mouse hover highlights, click/Enter activates, Shift+Enter plays-and-stays, Esc/backdrop/`⌘K` closes.

**Files:**
- Create: `src/components/CommandPalette.tsx`
- Modify: `src/App.tsx` (imports + render at root)
- Modify: `src/lib/events.ts` (global keydown handler)

- [ ] **Step 1: Create the CommandPalette component**

Create `src/components/CommandPalette.tsx` with this exact content:

```tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSearchPlaylists, useSearchTracks, useSearchUsers } from "../api/queries";
import type { Playlist, Track, User } from "../api/types";
import { artwork, fmtCount, trackArt, trackArtist, trackTitle } from "../lib/format";
import { closeCommandPalette, useCommandPalette } from "../lib/commandPalette";
import { playPlaylist } from "../player/playPlaylist";
import { playContext } from "../player/queueStore";
import { IconList, IconSearch, IconUser, Spinner } from "./Icons";

const MAX_TRACKS = 4;
const MAX_ARTISTS = 3;
const MAX_PLAYLISTS = 3;

type Item =
  | { kind: "track"; track: Track }
  | { kind: "artist"; user: User }
  | { kind: "playlist"; playlist: Playlist }
  | { kind: "showAll" };

/** Mount the inner palette only while open so its search hooks reset each time. */
export function CommandPalette() {
  const open = useCommandPalette((s) => s.open);
  if (!open) return null;
  return <CommandPaletteInner />;
}

function CommandPaletteInner() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  // Debounce the raw input into the query that drives the search hooks.
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 250);
    return () => clearTimeout(t);
  }, [input]);

  const hasQuery = query.length > 1;
  const tracksQ = useSearchTracks(query);
  const usersQ = useSearchUsers(query);
  const playlistsQ = useSearchPlaylists(query);

  const tracks = useMemo(
    () => (tracksQ.data?.pages[0]?.collection ?? []).slice(0, MAX_TRACKS),
    [tracksQ.data],
  );
  const artists = useMemo(
    () => (usersQ.data?.pages[0]?.collection ?? []).slice(0, MAX_ARTISTS),
    [usersQ.data],
  );
  const playlists = useMemo(
    () => (playlistsQ.data?.pages[0]?.collection ?? []).slice(0, MAX_PLAYLISTS),
    [playlistsQ.data],
  );

  // One flat list in render order so keyboard nav has a single index space.
  const items = useMemo<Item[]>(() => {
    if (!hasQuery) return [];
    return [
      ...tracks.map((track): Item => ({ kind: "track", track })),
      ...artists.map((user): Item => ({ kind: "artist", user })),
      ...playlists.map((playlist): Item => ({ kind: "playlist", playlist })),
      { kind: "showAll" },
    ];
  }, [hasQuery, tracks, artists, playlists]);

  // Keep the highlight inside the current item range.
  useEffect(() => {
    setHighlight((h) => Math.min(Math.max(h, 0), Math.max(0, items.length - 1)));
  }, [items.length]);

  const anyLoading =
    hasQuery && (tracksQ.isLoading || usersQ.isLoading || playlistsQ.isLoading);
  const noResults =
    hasQuery && !anyLoading && tracks.length === 0 && artists.length === 0 && playlists.length === 0;

  const goSearch = () => {
    navigate(`/search?q=${encodeURIComponent(query)}`);
    closeCommandPalette();
  };

  // Enter / click: act and close.
  const activate = (item: Item) => {
    switch (item.kind) {
      case "track": {
        const idx = tracks.findIndex((t) => t.id === item.track.id);
        playContext(tracks, Math.max(0, idx));
        closeCommandPalette();
        break;
      }
      case "artist":
        navigate(`/artist/${item.user.id}`);
        closeCommandPalette();
        break;
      case "playlist":
        navigate(`/playlist/${item.playlist.id}`);
        closeCommandPalette();
        break;
      case "showAll":
        goSearch();
        break;
    }
  };

  // Shift+Enter: play and keep the overlay open (tracks + playlists); else fall back.
  const playStay = (item: Item) => {
    switch (item.kind) {
      case "track": {
        const idx = tracks.findIndex((t) => t.id === item.track.id);
        playContext(tracks, Math.max(0, idx));
        break;
      }
      case "playlist":
        void playPlaylist(item.playlist);
        break;
      default:
        activate(item);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeCommandPalette();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[highlight];
      if (!item) return;
      if (e.shiftKey) playStay(item);
      else activate(item);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeCommandPalette();
      }}
    >
      <div className="w-[34rem] max-w-[92vw] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
          <IconSearch size={16} className="text-zinc-500" />
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search tracks, artists, playlists…"
            className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          />
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-2">
          {!hasQuery ? (
            <div className="px-4 py-6 text-center text-sm text-zinc-600">
              Type to search SoundCloud
            </div>
          ) : anyLoading && items.length <= 1 ? (
            <div className="flex justify-center py-8 text-zinc-500">
              <Spinner size={24} />
            </div>
          ) : noResults ? (
            <>
              <div className="px-4 py-5 text-center text-sm text-zinc-600">No results</div>
              <Row
                item={{ kind: "showAll" }}
                index={items.length - 1}
                active={highlight === items.length - 1}
                query={query}
                onHover={setHighlight}
                onActivate={activate}
              />
            </>
          ) : (
            <ResultList
              items={items}
              highlight={highlight}
              query={query}
              onHover={setHighlight}
              onActivate={activate}
            />
          )}
        </div>

        <div className="border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-600">
          ↑↓ navigate · ↵ open · ⇧↵ play · esc close
        </div>
      </div>
    </div>
  );
}

function ResultList({
  items,
  highlight,
  query,
  onHover,
  onActivate,
}: {
  items: Item[];
  highlight: number;
  query: string;
  onHover: (i: number) => void;
  onActivate: (item: Item) => void;
}) {
  let lastKind = "";
  return (
    <>
      {items.map((item, i) => {
        const header = item.kind !== lastKind && item.kind !== "showAll" ? sectionLabel(item.kind) : null;
        lastKind = item.kind;
        return (
          <div key={i}>
            {header && (
              <div className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                {header}
              </div>
            )}
            <Row
              item={item}
              index={i}
              active={i === highlight}
              query={query}
              onHover={onHover}
              onActivate={onActivate}
            />
          </div>
        );
      })}
    </>
  );
}

function sectionLabel(kind: Item["kind"]): string {
  if (kind === "track") return "Tracks";
  if (kind === "artist") return "Artists";
  return "Playlists";
}

function Row({
  item,
  index,
  active,
  query,
  onHover,
  onActivate,
}: {
  item: Item;
  index: number;
  active: boolean;
  query: string;
  onHover: (i: number) => void;
  onActivate: (item: Item) => void;
}) {
  return (
    <button
      type="button"
      onMouseEnter={() => onHover(index)}
      onClick={() => onActivate(item)}
      className={`flex w-full items-center gap-3 px-4 py-2 text-left ${active ? "bg-white/10" : ""}`}
    >
      <RowContent item={item} query={query} />
    </button>
  );
}

function RowContent({ item, query }: { item: Item; query: string }) {
  switch (item.kind) {
    case "track":
      return (
        <>
          <Thumb src={trackArt(item.track, 120)} rounded="rounded" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-zinc-100">{trackTitle(item.track)}</div>
            <div className="truncate text-xs text-zinc-500">{trackArtist(item.track)}</div>
          </div>
        </>
      );
    case "artist":
      return (
        <>
          <Thumb
            src={artwork(item.user.avatar_url, 120)}
            rounded="rounded-full"
            fallback={<IconUser size={16} />}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-zinc-100">{item.user.username ?? "Unknown"}</div>
            <div className="truncate text-xs text-zinc-500">
              {item.user.followers_count != null
                ? `${fmtCount(item.user.followers_count)} followers`
                : "Artist"}
            </div>
          </div>
        </>
      );
    case "playlist":
      return (
        <>
          <Thumb
            src={artwork(
              item.playlist.artwork_url ??
                item.playlist.tracks[0]?.artwork_url ??
                item.playlist.user?.avatar_url,
              120,
            )}
            rounded="rounded"
            fallback={<IconList size={16} />}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-zinc-100">{item.playlist.title ?? "Untitled"}</div>
            <div className="truncate text-xs text-zinc-500">
              Playlist · {item.playlist.track_count ?? item.playlist.tracks.length} tracks
            </div>
          </div>
        </>
      );
    case "showAll":
      return (
        <>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-zinc-500">
            <IconSearch size={16} />
          </div>
          <div className="truncate text-sm text-zinc-300">Show all results for “{query}”</div>
        </>
      );
  }
}

function Thumb({
  src,
  rounded,
  fallback,
}: {
  src: string | null;
  rounded: string;
  fallback?: React.ReactNode;
}) {
  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden bg-zinc-800 text-zinc-600 ${rounded}`}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        fallback
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render the palette at the app root**

In `src/App.tsx`, add the import near the other component imports (after the `CommandPalette`-adjacent ones, alphabetical is fine):

```tsx
import { CommandPalette } from "./components/CommandPalette";
```

Then in the logged-in `return (...)` block, add `<CommandPalette />` next to the other root-level modals. Change:

```tsx
      <PlayerBar />
      <AuthModals />
      <PlaylistModals />
    </div>
```

to:

```tsx
      <PlayerBar />
      <AuthModals />
      <PlaylistModals />
      <CommandPalette />
    </div>
```

- [ ] **Step 3: Add the global ⌘K shortcut**

In `src/lib/events.ts`, add the import at the top (with the other `./` imports):

```ts
import { toggleCommandPalette } from "./commandPalette";
```

Then, in the `window.addEventListener("keydown", ...)` handler, add the `⌘/Ctrl+K` case **before** the typing guard so it fires even when a text field is focused. Change:

```ts
  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable;
    if (typing) return;
```

to:

```ts
  window.addEventListener("keydown", (e) => {
    // ⌘K / Ctrl+K toggles quick search from anywhere, even while typing.
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      toggleCommandPalette();
      return;
    }
    const target = e.target as HTMLElement | null;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable;
    if (typing) return;
```

- [ ] **Step 4: Type-check**

Run: `pnpm build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 5: Manual smoke test**

Run: `pnpm tauri dev` (must be signed in). Then verify:
- Press `⌘K` (mac) — the panel drops in near the top, input focused. Press `⌘K` again — it closes. Open again, press `Esc` — closes. Open again, click the dimmed backdrop — closes.
- Open and type a real artist/track name (≥2 chars). After ~250ms, sections `TRACKS` / `ARTISTS` / `PLAYLISTS` appear with a few rows each, plus a "Show all results for …" row. The first row is highlighted.
- Move the mouse over rows — the highlight follows the cursor.
- Click a **track** row — it starts playing and the panel closes. Reopen, click an **artist** row — navigates to that artist page, panel closes. Reopen, click a **playlist** row — navigates to the playlist page, panel closes.
- `⌘K` still opens the panel while a text field elsewhere has focus.

Report the actual observed behavior. If sign-in or network prevents results, say so.

- [ ] **Step 6: Commit**

```bash
git add src/components/CommandPalette.tsx src/App.tsx src/lib/events.ts
git commit -m "feat(search): add ⌘K quick-search overlay"
```

---

## Task 3: Keyboard activation (Enter / Shift+Enter)

The keyboard handler is already in the component from Task 2. This task is the dedicated manual verification of arrow + Enter + Shift+Enter behavior (nothing to write unless a defect is found).

**Files:**
- (verification only; `src/components/CommandPalette.tsx` already contains `onKeyDown`)

- [ ] **Step 1: Manual smoke test — keyboard nav**

Run: `pnpm tauri dev`. Open `⌘K`, type a query with results, then:
- `↓` / `↑` move the highlight across **all** rows, including across section boundaries and onto the final "Show all" row, clamping at top and bottom.
- With a **track** highlighted, press `↵` — it plays and the panel closes.
- Reopen, highlight a **track**, press `⇧↵` — it plays and the panel **stays open** (PlayerBar shows it playing; you can keep navigating).
- Highlight a **playlist**, press `⇧↵` — the playlist starts playing and the panel stays open.
- Highlight an **artist**, press `⇧↵` — falls back to navigate + close (artists have no "play").
- Highlight "Show all results", press `↵` — navigates to `/search?q=…` and closes. (Full results land in Task 4.)

- [ ] **Step 2: If a defect is found, fix it in `src/components/CommandPalette.tsx`**

Only if Step 1 reveals a bug, edit the `onKeyDown` / `activate` / `playStay` functions to correct it, re-run `pnpm build` (expected: 0 errors), and re-test. If no defect, skip.

- [ ] **Step 3: Commit (only if Step 2 changed code)**

```bash
git add src/components/CommandPalette.tsx
git commit -m "fix(search): correct command-palette keyboard activation"
```

If no code changed, there is nothing to commit — note that and move on.

---

## Task 4: Deep-link the full /search page from "Show all"

Teach `/search` to read a `?q=` param so the overlay's "Show all results" opens the full tabbed page already showing those results, and stays in sync if the page is already mounted.

**Files:**
- Modify: `src/pages/SearchPage.tsx`

- [ ] **Step 1: Read `?q=` in SearchPage**

In `src/pages/SearchPage.tsx`, add `useSearchParams` to the React Router import. There is currently no router import in this file, so add:

```tsx
import { useSearchParams } from "react-router-dom";
```

Then change the state initialization. Replace:

```tsx
export function SearchPage() {
  const [input, setInput] = useState(() => sessionStorage.getItem("search-q") ?? "");
  const [query, setQuery] = useState(input);
  const [tab, setTab] = useState<Tab>("tracks");

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(input.trim());
      sessionStorage.setItem("search-q", input.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [input]);
```

with:

```tsx
export function SearchPage() {
  const [params] = useSearchParams();
  const [input, setInput] = useState(
    () => params.get("q") ?? sessionStorage.getItem("search-q") ?? "",
  );
  const [query, setQuery] = useState(input);
  const [tab, setTab] = useState<Tab>("tracks");

  // Deep-link from the ⌘K overlay: when the URL query changes (incl. while this
  // page is already mounted), adopt it.
  useEffect(() => {
    const q = params.get("q");
    if (q != null) {
      setInput(q);
      setQuery(q.trim());
    }
  }, [params]);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(input.trim());
      sessionStorage.setItem("search-q", input.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [input]);
```

- [ ] **Step 2: Type-check**

Run: `pnpm build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 3: Manual smoke test**

Run: `pnpm tauri dev`.
- From any page, `⌘K`, type a query, click (or `↵` on) "Show all results for …". The full `/search` page opens with the input pre-filled and tracks already listed.
- Repeat while already on `/search` (open `⌘K` from the search page, type a different query, "Show all") — the page input/results update to the new query.
- Open the sidebar "Search" directly (no `?q=`) — still works, falling back to the last `sessionStorage` query as before.

- [ ] **Step 4: Commit**

```bash
git add src/pages/SearchPage.tsx
git commit -m "feat(search): deep-link /search page via ?q= param"
```

---

## Final verification

- [ ] Run `pnpm build` once more — expected: exits 0.
- [ ] Confirm the full flow end-to-end in `pnpm tauri dev`: `⌘K` → type → arrow/Enter/Shift+Enter on each result type → "Show all" → `Esc`/backdrop/`⌘K` close.
- [ ] No regression to existing shortcuts (Space toggles play, Shift+←/→ prev/next, `⌘[`/`⌘]` back/forward) when the palette is closed.

## Self-review checklist (done by the planner)

- **Spec coverage:** trigger + toggle (Task 2 Step 3), top-center floating overlay (Task 2 Step 1), mixed sections sliced to 4/3/3 (Task 2 Step 1), Enter activation table (Task 2/3), Shift+Enter play-and-stay incl. artist/showAll fallback (Task 2/3), "Show all" deep-link + SearchPage sync (Task 4), states: <2 chars / loading / empty / per-section failure (Task 2 Step 1 — independent queries, empty-section renders nothing, `noResults` branch). No sidebar hint (correctly omitted). No backend changes. ✅
- **Placeholder scan:** every code step contains complete, final code. ✅
- **Type consistency:** `Item` union, `activate`/`playStay`/`goSearch`, `useCommandPalette`/`toggleCommandPalette`/`closeCommandPalette`, `playContext(tracks, index)`, `playPlaylist(playlist)`, `trackArt/trackTitle/trackArtist/artwork/fmtCount`, and the search hooks' `data.pages[0].collection` shape all match the real source read during planning. ✅
