# ⌘K Quick-Search: Universal Endpoint + Spotify-style Flat Results

**Date:** 2026-06-18
**Status:** Approved
**Supersedes the results portion of:** `2026-06-17-cmdk-search-design.md`

## Problem

The ⌘K quick-search "doesn't feel great":

1. **Slow / laggy.** A 250ms debounce plus three independent network requests
   (`/search/tracks`, `/search/users`, `/search/playlists`) per keystroke.
2. **Results blank on every keystroke.** Each debounced query made a new
   TanStack query key, so `data` went `undefined` and the panel flashed a
   centered spinner before repopulating. *(Already fixed on this branch via
   `placeholderData: keepPreviousData` + 150ms debounce.)*
3. **Results jump around.** The three requests resolve at different times and
   each section shoves the others as it lands, so the list reorders itself
   mid-load.
4. **Grouped sections** (Tracks / Artists / Playlists) don't match the desired
   Spotify-style single mixed list.

## Goal

A single, flat, relevance-ranked result list — Spotify quick-search style —
that loads fast and never rearranges itself. Reference screenshots (Spotify
desktop quick search) provided by the user show:

- One ungrouped list ordered purely by relevance; no section headers, no
  separate "Top result" card. The first row is simply the default-highlighted
  selection.
- A right-aligned type **pill** per row: `Track` · `Album` · `Artist` ·
  `Playlist`.
- **Circular** artwork for artists, **square** for tracks / albums / playlists.
- Title + subtitle (artist name(s), or creator name for playlists).
- Currently-playing item rendered in the app's green accent (existing
  convention).

## Approach

Switch from three type-specific endpoints to SoundCloud api-v2's **universal
`/search`** endpoint, which returns one relevance-ranked collection where each
item carries a `kind` field (`track` / `user` / `playlist`). This is the lever
that addresses every point above at once:

- **Faster** — one network round-trip instead of three; one cache entry.
- **No jumping** — one response renders atomically; the list never reorders
  mid-load.
- **Spotify-style** — the endpoint's native relevance order *is* the flat list.
  No client-side merging, ranking, or top-result promotion needed (YAGNI).

### Risk / first step

The repo has a history of api-v2 surprises (see memory: api-v2 quirks). Before
building UI on it, **verify the live `/search` endpoint** returns well-ranked
mixed results on the user's (free) account: that it includes all three kinds,
ranks sensibly, and supports `q` + `limit` + `linked_partitioning`. If the
ranking is poor, fall back to merging the three existing endpoints client-side
(out of scope unless the verification fails).

## Backend (Rust)

### `SearchItem` model (`sc/models.rs`)

A tagged enum mirroring the existing `ResolvedEntity`:

```rust
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SearchItem {
    Track { track: Track },
    User { user: User },
    Playlist { playlist: Playlist },
}
```

Unknown / unsupported kinds (e.g. `user-playlist` collections, system
playlists, "Unknown") are filtered out during page parsing rather than carried
as an `Unknown` variant, so the frontend list contains only renderable items.

### Endpoint (`sc/endpoints.rs`)

```rust
pub async fn ep_search_all(&self, q: &str, next: Option<String>) -> Result<Page<SearchItem>>
```

Hits `/search?q=…&limit=20&linked_partitioning=1` (same `lp(20)` + `q` param
shape as the existing `search_page`), parses into `Page<SearchItem>`, dropping
items that fail to deserialize into a known kind. Pagination follows the
existing `next_href` convention (empty page = end of list).

### Command (`commands.rs`)

```rust
#[tauri::command]
pub async fn search_all(sc: Sc<'_>, q: String, next_href: Option<String>) -> Result<Page<SearchItem>>
```

Registered in the Tauri handler list alongside the existing search commands.
The old `search_tracks` / `search_users` / `search_playlists` commands stay for
now (still used by the full `/search` page and as a fallback); removing them is
out of scope.

## Frontend

### Types (`api/types.ts`)

A `SearchItem` discriminated union matching the Rust enum:
`{ kind: "track"; track: Track } | { kind: "user"; user: User } | { kind: "playlist"; playlist: Playlist }`.

### Command + query (`api/commands.ts`, `api/queries.ts`)

- `api.searchAll(q, next)` → invokes `search_all`.
- `useSearchAll(q)` — `useInfinite(["search", "all", q], …, q.length > 1, true)`,
  reusing the `keepPrevious` flag already added to `useInfinite`.

### `CommandPalette.tsx`

Replace the three hooks with one `useSearchAll(query)`. Render the first page's
collection as one flat `Item[]` (cap ~16 for the preview; the list scrolls),
followed by the existing "Show all results for '<q>'" row.

Per-row anatomy:
- **Artwork:** circular for `kind === "user"`, square otherwise. Reuse existing
  `artwork` / `trackArt` helpers.
- **Title + subtitle:** track → title / artist(s); user → username with no
  subtitle (matches the reference screenshots); playlist → title / creator.
  Currently-playing track uses the green accent (existing logic).
- **Type pill (right-aligned):** `Track` · `Artist` · `Playlist`, and `Album`
  when a playlist's `is_album` flag is set.

Keyboard / activation semantics are unchanged from the current palette:
- Default highlight on row 0; ↑/↓ move; Enter activates; Shift+Enter
  plays-and-stays; Esc / backdrop closes.
- **Enter** — track: play; user: navigate to `/artist/:id`; playlist/album:
  navigate to `/playlist/:id`; show-all: navigate to `/search?q=`.
- **Shift+Enter** — track: play and keep open; playlist: start playlist and keep
  open; else fall back to activate.
- **Playing a track** builds the queue from only the *track* items in the list
  (filter `kind === "track"`) so next/prev flows through search tracks, matching
  today's behavior.

### Loading / feel (already on branch, retained)

- 150ms debounce.
- `keepPreviousData` so the list updates in place and never blanks.
- First-load shows the centered spinner only when there's no prior data; an
  inline spinner in the search-input row indicates background refetches.

## Out of scope

- Removing the old per-type search commands/hooks (still used by `/search`).
- Recent-searches, command actions, sidebar hints.
- Client-side ranking / top-result promotion (only if endpoint verification
  fails).
- Prefetch-on-hover / payload trimming (marginal once on one request).

## Testing / verification

- **Endpoint verification (first):** call the live `/search` and confirm mixed,
  well-ranked results on the user's account.
- **Manual:** run the app, open ⌘K, type a partial artist name and a song name;
  confirm one flat list, correct pills (incl. Album vs Playlist), circular
  artist art, no jumping, no blanking between keystrokes, and that
  Enter/Shift+Enter behaviors work for each kind.
- Typecheck (`tsc --noEmit`) and `cargo check` for the Rust side.
