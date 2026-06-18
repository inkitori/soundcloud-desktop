# Cmd+K Quick-Search Overlay — Design

**Date:** 2026-06-17
**Status:** Approved (pending spec review)

## Goal

Add a Spotify-style quick-search overlay opened with `⌘K` (`Ctrl+K` on
non-mac). Press it anywhere in the app to get a floating search panel that
shows a few mixed top results across tracks, artists, and playlists, fully
keyboard-drivable, without leaving the current page.

## Behavior

- `⌘K` / `Ctrl+K` toggles the overlay open/closed from anywhere — including
  while focus is in a text input. `Esc` or a click on the dimmed backdrop
  closes it.
- The panel floats near the **top-center** of the window (Raycast/Spotify
  position), over a dimmed backdrop. The search input is auto-focused on open.
- As the user types (debounced ~250ms, requires ≥2 chars), the panel shows
  **mixed top results** grouped into three labeled sections:
  - `TRACKS` — top ~4 from page 1
  - `ARTISTS` — top ~3 from page 1
  - `PLAYLISTS` — top ~3 from page 1
- A final row, **"Show all results for '<query>'"**, always renders when there
  is a query.
- Keyboard navigation uses a single flat highlight index spanning every visible
  row (all sections + the "show all" row). `↑/↓` moves it; the highlight wraps
  is not required (clamp at ends is fine). Mouse hover sets the highlight;
  clicking a row activates it (plain-activate semantics, same as `↵`).
- Footer hint text: `↑↓ navigate · ↵ open · ⇧↵ play · esc close`.

### Activation semantics

**`↵` Enter / click — activate & close:**

| Highlighted row | Action |
| --- | --- |
| Track | `playContext(visibleTrackResults, index)` then close |
| Artist | `navigate('/artist/:id')` then close |
| Playlist | `navigate('/playlist/:id')` then close |
| "Show all results" | `navigate('/search?q=<query>')` then close |

If nothing is highlighted, `↵` activates the "Show all results" row.

**`⇧↵` Shift+Enter — play & stay (overlay remains open):**

| Highlighted row | Action |
| --- | --- |
| Track | `playContext(visibleTrackResults, index)`, keep overlay open |
| Playlist | `playPlaylist(playlist)`, keep overlay open |
| Artist | no "play" semantics → falls back to plain Enter (navigate + close) |
| "Show all results" | falls back to plain Enter (navigate + close) |

This mirrors Spotify: Shift+Enter on a song plays it without leaving search,
so the user can keep queueing.

## Architecture

No backend changes. The overlay reuses the existing search Tauri commands
(`search_tracks` / `search_users` / `search_playlists`) via the existing
`useSearchTracks` / `useSearchUsers` / `useSearchPlaylists` infinite-query
hooks — it simply slices the top N from page 1 (`data.pages[0].collection`).

### New: `src/lib/commandPalette.ts`

Tiny Zustand store mirroring the `lib/modals.ts` pattern:

```ts
interface CommandPaletteState { open: boolean }
export const useCommandPalette = create<CommandPaletteState>(() => ({ open: false }));
export function openCommandPalette()  { useCommandPalette.setState({ open: true }); }
export function closeCommandPalette() { useCommandPalette.setState({ open: false }); }
export function toggleCommandPalette() {
  useCommandPalette.setState((s) => ({ open: !s.open }));
}
```

### New: `src/components/CommandPalette.tsx`

- Subscribes to `useCommandPalette`. Renders `null` when closed.
- Local state: `input` (raw), `query` (debounced & trimmed), `highlight` (flat
  index).
- Calls the three search hooks with `query`; derives sliced result arrays
  (`tracks` ≤4, `artists` ≤3, `playlists` ≤3) with `useMemo`.
- Builds a flat list of "navigable items" in render order
  (tracks → artists → playlists → show-all) so `↑/↓` and activation can index
  into one array regardless of section.
- Keydown handling on the input: `↑`/`↓` move highlight; `Enter` /
  `Shift+Enter` activate per the table above; `Esc` closes (the panel also
  registers Esc the same way `Modal.tsx` does). Reset `highlight` to 0 and
  clear stale state whenever `query` changes or the panel opens.
- Row visuals reuse / mirror the existing `TrackRow` / `UserRow` /
  `PlaylistRow` look (compact single-line rows: artwork/avatar + primary text +
  secondary text) so it matches the app. Tailwind, dark theme, `orange` accent
  on the highlighted row.
- On open: focus the input; on close: clear `input`/`query` (next open starts
  fresh) — matches Spotify's quick switcher resetting each time.

### Edit: `src/lib/events.ts`

Add `⌘/Ctrl+K → toggleCommandPalette()` to the global keydown handler. This
case must be evaluated **before** the existing "ignore when typing in an
input/textarea" guard, so the shortcut still fires when focus is in a field.
`preventDefault()` on the chord.

### Edit: `src/App.tsx`

Render `<CommandPalette />` once at the top level, alongside `<AuthModals />` /
`<PlaylistModals />` (inside the logged-in tree).

### Edit: `src/pages/SearchPage.tsx`

Read `q` (and optionally `tab`) from the URL via `useSearchParams`, so the
overlay's "Show all results" can deep-link (`/search?q=…`) and the full page
opens already showing those results. Falls back to today's `sessionStorage`
behavior when no `q` param is present. Keep the existing debounce/tab UX
otherwise unchanged.

## States & errors

- **<2 chars:** show a hint line ("Type to search SoundCloud") and the panel
  stays small.
- **Loading:** the three queries are independent; show a spinner while the
  first results are still loading, and render each section as its data arrives.
- **Empty:** when all three return nothing, show "No results" (the "Show all"
  row still renders so the user can jump to the full page).
- **Per-section failure:** a failing query renders nothing for that section
  rather than breaking the panel (the other sections still show).

## Out of scope (YAGNI)

- No command/action entries (go-to-page, play/pause, etc.) — search only.
- No recent-searches / history.
- No backend changes; no new Tauri commands.
- No changes to the sidebar (no `⌘K` hint).

## Testing / verification

This project has no test runner wired up (no `test` script in `package.json`,
no test harness present), so TDD is not applicable here. Verification is:

1. **`pnpm build`** — runs `tsc` and Vite build; catches type errors across the
   new + edited files.
2. **Manual smoke test** in `pnpm tauri dev`:
   - `⌘K` opens the overlay from several pages; `⌘K` again and `Esc` and
     backdrop-click each close it.
   - Typing shows mixed sections; `↑/↓` highlights across sections; mouse hover
     highlights; clicking activates.
   - `↵` on a track plays + closes; on an artist navigates to `/artist/:id` +
     closes; on a playlist navigates to `/playlist/:id` + closes; on "Show all"
     opens `/search?q=…` + closes.
   - `⇧↵` on a track plays and keeps the overlay open; on a playlist starts the
     playlist and stays open.
   - `⌘K` still works while focus is in a text input.

Anything that can't be verified locally will be called out explicitly.
