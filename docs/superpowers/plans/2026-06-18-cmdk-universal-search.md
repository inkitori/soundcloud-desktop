# ⌘K Universal Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ⌘K palette's three type-specific search requests with SoundCloud's single universal `/search` endpoint, rendered as one flat, relevance-ranked, Spotify-style list with right-aligned type pills.

**Architecture:** A new Rust endpoint hits api-v2 `/search`, parses the mixed collection into a `SearchItem` tagged enum (track/user/playlist) by reading each item's `kind` field — mirroring the existing `ep_resolve` pattern — and returns `Page<SearchItem>`. A new Tauri command exposes it. The frontend swaps the three search hooks for one `useSearchAll`, builds a single ordered item list, and renders flat rows with circular artist art and right-aligned `Track`/`Album`/`Artist`/`Playlist` pills. The keepPreviousData + 150ms debounce already on this branch are retained.

**Tech Stack:** Rust (Tauri commands, serde, serde_json), TypeScript/React, TanStack Query v5.

**Spec:** `docs/superpowers/specs/2026-06-18-cmdk-universal-search-design.md`

---

## File Structure

- `src-tauri/src/sc/models.rs` — add `SearchItem` enum (Serialize-only, tag = "kind").
- `src-tauri/src/sc/endpoints.rs` — add `ep_search_all` + a `parse_search_collection` helper with a unit test.
- `src-tauri/src/commands.rs` — add `search_all` command.
- `src-tauri/src/lib.rs` — register `search_all` in the invoke handler.
- `src/api/types.ts` — add `SearchItem` union.
- `src/api/commands.ts` — add `searchAll`.
- `src/api/queries.ts` — add `useSearchAll`.
- `src/components/CommandPalette.tsx` — one hook, flat ordered list, type pills, circular artist art; drop section grouping.

---

## Task 1: `SearchItem` model (Rust)

**Files:**
- Modify: `src-tauri/src/sc/models.rs` (after the `ResolvedEntity` enum, ~line 172)

- [ ] **Step 1: Add the enum**

Add below `ResolvedEntity`:

```rust
/// One item from the universal `/search` collection. Serialize-only: built by
/// hand from each item's `kind` discriminator (mirrors `ResolvedEntity`), then
/// sent to the frontend as `{ "kind": "...", "<field>": {...} }`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SearchItem {
    Track { track: Track },
    User { user: User },
    Playlist { playlist: Playlist },
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles (warning about `SearchItem` being unused is fine until Task 2).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/sc/models.rs
git commit -m "feat(search): add SearchItem model for universal search"
```

---

## Task 2: `/search` endpoint + parser with unit test (Rust)

**Files:**
- Modify: `src-tauri/src/sc/endpoints.rs` (add helper + method near the other `ep_search_*`, ~line 263; add `use` for `SearchItem`)

- [ ] **Step 1: Write the failing unit test**

At the bottom of `src-tauri/src/sc/endpoints.rs` add:

```rust
#[cfg(test)]
mod search_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_mixed_kinds_and_skips_unknown() {
        let v = json!({
            "collection": [
                { "kind": "track", "id": 1, "title": "A", "user": { "id": 9, "username": "u" } },
                { "kind": "user", "id": 2, "username": "Artist" },
                { "kind": "playlist", "id": 3, "title": "P", "user": { "id": 9, "username": "u" } },
                { "kind": "something-else", "id": 4 }
            ],
            "next_href": "https://api-v2.soundcloud.com/search?offset=20"
        });
        let page = parse_search_collection(v);
        assert_eq!(page.collection.len(), 3, "unknown kind should be skipped");
        assert!(matches!(page.collection[0], SearchItem::Track { .. }));
        assert!(matches!(page.collection[1], SearchItem::User { .. }));
        assert!(matches!(page.collection[2], SearchItem::Playlist { .. }));
        assert_eq!(page.next_href.as_deref(), Some("https://api-v2.soundcloud.com/search?offset=20"));
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test search_tests`
Expected: FAIL — `parse_search_collection` not found.

- [ ] **Step 3: Add the import**

At the top of `endpoints.rs`, add `SearchItem` to the models import (the line importing `Track`, `User`, etc.). Confirm the exact existing line first with `grep -n "use super::models" src-tauri/src/sc/endpoints.rs` and append `SearchItem` to that list.

- [ ] **Step 4: Implement the parser + endpoint**

Add the free function near the other parsing/`ep_search_*` code:

```rust
/// Build a `Page<SearchItem>` from a universal `/search` response, reading each
/// item's `kind` field and dropping any item that isn't a renderable kind or
/// fails to deserialize (same resilience as `parse_items`).
fn parse_search_collection(v: serde_json::Value) -> Page<SearchItem> {
    let next_href = v.get("next_href").and_then(Value::as_str).map(str::to_owned);
    let collection = v
        .get("collection")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let kind = item.get("kind").and_then(Value::as_str)?;
                    match kind {
                        "track" => serde_json::from_value::<Track>(item.clone())
                            .ok()
                            .map(|track| SearchItem::Track { track }),
                        "user" => serde_json::from_value::<User>(item.clone())
                            .ok()
                            .map(|user| SearchItem::User { user }),
                        "playlist" => serde_json::from_value::<Playlist>(item.clone())
                            .ok()
                            .map(|playlist| SearchItem::Playlist { playlist }),
                        _ => None,
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    Page { collection, next_href }
}
```

Add the method inside the `impl` block alongside `ep_search_tracks`:

```rust
pub async fn ep_search_all(&self, q: &str, next: Option<String>) -> Result<Page<SearchItem>> {
    let v = match next {
        Some(href) => self.get_value(&href, &[]).await?,
        None => {
            let mut params = lp(20);
            params.push(("q", q.to_string()));
            self.get_value("/search", &params).await?
        }
    };
    Ok(parse_search_collection(v))
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd src-tauri && cargo test search_tests`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/sc/endpoints.rs
git commit -m "feat(search): add ep_search_all universal endpoint + parser test"
```

---

## Task 3: `search_all` command + registration (Rust)

**Files:**
- Modify: `src-tauri/src/commands.rs` (after `search_playlists`, ~line 264)
- Modify: `src-tauri/src/lib.rs` (invoke handler list, ~line 73)

- [ ] **Step 1: Add the command**

In `commands.rs`, after `search_playlists`. First confirm `SearchItem` is importable — `search_tracks` already returns `Page<Track>`, so the models are in scope; add `SearchItem` to the existing models `use` in `commands.rs` if not already glob-imported (`grep -n "use crate::sc::models\|use super" src-tauri/src/commands.rs` to confirm, then append `SearchItem`).

```rust
#[tauri::command]
pub async fn search_all(sc: Sc<'_>, q: String, next_href: Option<String>) -> Result<Page<SearchItem>> {
    sc.ep_search_all(&q, next_href).await
}
```

- [ ] **Step 2: Register it**

In `src-tauri/src/lib.rs`, in the `tauri::generate_handler![...]` list, add after `commands::search_playlists,`:

```rust
            commands::search_all,
```

- [ ] **Step 3: Verify it compiles + tests pass**

Run: `cd src-tauri && cargo check && cargo test search_tests`
Expected: compiles, 1 test passes.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(search): expose search_all Tauri command"
```

---

## Task 4: Frontend types + command + hook

**Files:**
- Modify: `src/api/types.ts` (after the `Playlist` interface, before `Page`)
- Modify: `src/api/commands.ts` (after `searchPlaylists`, ~line 62)
- Modify: `src/api/queries.ts` (after `useSearchPlaylists`)

- [ ] **Step 1: Add the `SearchItem` union to `types.ts`**

```ts
export type SearchItem =
  | { kind: "track"; track: Track }
  | { kind: "user"; user: User }
  | { kind: "playlist"; playlist: Playlist };
```

- [ ] **Step 2: Add the command to `commands.ts`**

Add to the `api` object after `searchPlaylists`, and add `SearchItem` to the type import from `./types`:

```ts
  searchAll: (q: string, nextHref?: string) =>
    invoke<Page<SearchItem>>("search_all", { q, nextHref: nextHref ?? null }),
```

- [ ] **Step 3: Add the hook to `queries.ts`**

After `useSearchPlaylists`:

```ts
export function useSearchAll(q: string) {
  return useInfinite(["search", "all", q], (next) => api.searchAll(q, next), q.length > 1, true);
}
```

- [ ] **Step 4: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/api/types.ts src/api/commands.ts src/api/queries.ts
git commit -m "feat(search): add searchAll command + useSearchAll hook"
```

---

## Task 5: Flat Spotify-style results in `CommandPalette.tsx`

**Files:**
- Modify: `src/components/CommandPalette.tsx`

This task replaces the three hooks with one, builds a single ordered list, drops section grouping, and adds the type pill + Album detection. The `Item` union, keyboard nav, activation semantics, and `Thumb`/`Row` shells are reused.

- [ ] **Step 1: Swap the hooks + derive one ordered list**

Replace the imports line for the search hooks:

```ts
import { useSearchAll } from "../api/queries";
```

Replace the three-hook block and the three `useMemo` slices (current lines ~41–67) with:

```tsx
const searchQ = useSearchAll(query);

const MAX_RESULTS = 16;

// One flat list in SoundCloud's relevance order; first row is the default
// highlight (no separate "top result" card). `user` → `artist` Item kind.
const items = useMemo<Item[]>(() => {
  if (!hasQuery) return [];
  const collection = (searchQ.data?.pages[0]?.collection ?? []).slice(0, MAX_RESULTS);
  const mapped = collection.map((it): Item => {
    if (it.kind === "track") return { kind: "track", track: it.track };
    if (it.kind === "user") return { kind: "artist", user: it.user };
    return { kind: "playlist", playlist: it.playlist };
  });
  return [...mapped, { kind: "showAll" }];
}, [hasQuery, searchQ.data]);

// Tracks in list order, so playing one flows next/prev through search tracks.
const trackList = useMemo(
  () =>
    items.flatMap((it) => (it.kind === "track" ? [it.track] : [])),
  [items],
);
```

Note: `hasQuery` (line ~40) stays as-is. Remove the now-unused `MAX_TRACKS`/`MAX_ARTISTS`/`MAX_PLAYLISTS` consts (lines 11–13).

- [ ] **Step 2: Point loading flags + playTrack at the new hook**

Replace the `anyLoading` / `anyFetching` block:

```tsx
const anyLoading = hasQuery && searchQ.isLoading;
const anyFetching = hasQuery && searchQ.isFetching;
const noResults = hasQuery && !anyLoading && trackList.length === 0 && items.length <= 1;
```

Replace `playTrack` to use `trackList`:

```tsx
const playTrack = (track: Track) => {
  const idx = trackList.findIndex((t) => t.id === track.id);
  playContext(trackList, Math.max(0, idx));
};
```

- [ ] **Step 3: Render flat (drop section headers) + pass `noResults` spinner gate**

In `ResultList`, remove the `header`/`sectionLabel` logic so rows render flat. Replace the `ResultList` map body with:

```tsx
return (
  <>
    {items.map((item, i) => (
      <Row
        key={i}
        item={item}
        index={i}
        active={i === highlight}
        query={query}
        onHover={onHover}
        onActivate={onActivate}
      />
    ))}
  </>
);
```

Delete the now-unused `sectionLabel` function.

- [ ] **Step 4: Add the right-aligned type pill**

In `Row`, render the pill after `RowContent` (inside the `<button>`, so it sits at the right via `flex`):

```tsx
<RowContent item={item} query={query} />
{item.kind !== "showAll" && <TypePill item={item} />}
```

Add the component near `RowContent`:

```tsx
function TypePill({ item }: { item: Exclude<Item, { kind: "showAll" }> }) {
  const label =
    item.kind === "track"
      ? "Track"
      : item.kind === "artist"
        ? "Artist"
        : item.playlist.is_album
          ? "Album"
          : "Playlist";
  return (
    <span className="ml-auto shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-zinc-400">
      {label}
    </span>
  );
}
```

(The `min-w-0 flex-1` on `RowContent`'s text column already pushes the pill to the right; `ml-auto` is a safety.)

- [ ] **Step 5: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors. (If `Item` import of `Track` is now unused or `fmtCount` etc., remove dead imports the compiler flags.)

- [ ] **Step 6: Commit**

```bash
git add src/components/CommandPalette.tsx
git commit -m "feat(search): flat universal results with type pills in command palette"
```

---

## Task 6: Verify against the live endpoint + manual UX check

This is the spec's de-risking step (api-v2 has a history of surprises). Do it now that the path is wired end-to-end.

- [ ] **Step 1: Run the app**

Run: `npm run tauri dev` (or the project's usual dev command). Wait for the window.

- [ ] **Step 2: Exercise ⌘K**

Open ⌘K and type, slowly, a few queries: a partial artist name (e.g. the artist from the reference screenshots), a song title, and a playlist-ish term. Confirm:
  - One flat list appears, ordered by relevance (mix of kinds), **no section headers**.
  - The list does **not** jump/reorder as you keep typing (single atomic update).
  - The list does **not** blank to a spinner between keystrokes (previous results stay; small inline spinner shows in the input row while fetching).
  - Right-aligned pills read `Track` / `Artist` / `Playlist`, and `Album` for album-playlists.
  - Artist rows have **circular** artwork; others square.
  - ↑/↓ navigate; Enter opens/plays the right kind; Shift+Enter plays-and-stays for tracks/playlists; Esc closes.

- [ ] **Step 3: Decision gate**

If relevance/ranking is clearly bad or a kind is missing, STOP and report — the fallback (merging the three existing endpoints client-side) is out of scope and needs a design revisit. If it looks good, proceed.

- [ ] **Step 4: Final verification commands**

Run: `npx tsc --noEmit` and `cd src-tauri && cargo check && cargo test search_tests`
Expected: all clean, test passes.

- [ ] **Step 5: Commit any cleanup**

```bash
git add -A
git commit -m "chore(search): verify universal search end-to-end" --allow-empty
```

---

## Self-Review notes

- **Spec coverage:** universal endpoint (Tasks 1–4), flat ungrouped list (Task 5 Step 3), right pills incl. Album-via-`is_album` (Task 5 Step 4), circular artist art (reuses existing `RowContent` `rounded-full`), keepPreviousData/debounce (already on branch, untouched), verify-live-first (Task 6), parser resilience/skip-unknown (Task 2 test).
- **Type consistency:** Rust `SearchItem` variants `Track{track}/User{user}/Playlist{playlist}` ↔ TS union `track/user/playlist` ↔ palette maps `user`→`artist` Item. `Page<SearchItem>` used in command, hook, and `searchAll`.
- **Out of scope (unchanged):** old per-type commands/hooks remain for `/search` page; no client-side ranking unless Task 6 gate fails.
