# SoundCloud Desktop

A personal SoundCloud client for macOS. Tauri 2 + Rust backend, React frontend.
Custom UI over SoundCloud's internal `api-v2` (the same API their web app uses),
authenticated with your own account via an embedded sign-in window.

## Screenshots

| Feed | Likes |
| --- | --- |
| ![Home feed](screenshots/feed.png) | ![Liked tracks](screenshots/likes.png) |

| Search | Artist page |
| --- | --- |
| ![Search](screenshots/search.png) | ![Artist page](screenshots/artist.png) |

## Features

- **Sign in with SoundCloud** — embedded sign-in window, no token copying; the
  session (and DataDome clearance for write ops) is captured automatically
- **Home feed** — tracks and reposts from artists you follow, infinite scroll
- **Likes, reposts & follows** — like/repost tracks and playlists, follow artists,
  all with instant toggles everywhere
- **Playlists** — browse/play your library, create playlists, add/remove tracks
  via an add-to-playlist picker
- **Search & artist pages** — tracks / artists / playlists, with popular, albums,
  reposts & likes tabs; your own profile (uploads + reposts) lives in the sidebar
- **Station autoplay** — when the queue runs out, related tracks keep playing (toggleable)
- **Offline downloads** — cache tracks locally (HLS → ffmpeg remux to .m4a), LRU cache with size cap, plays offline
- **Real player** — queue management, canvas waveform seeking, media keys, macOS Now Playing / Control Center integration
- **Discord Rich Presence** — "Listening to SoundCloud" with track, artist, artwork, and a live progress bar (Spotify-style); hides while paused, toggleable in Settings
- Go+-only tracks play their 30s preview (free account); geo-blocked tracks are skipped

## Install

```sh
brew tap inkitori/tap
brew trust inkitori/tap
brew install --cask soundcloud-desktop
xattr -cr "/Applications/SoundCloud Desktop.app"
```

The `xattr` step is needed because the app isn't notarized with Apple — without
it, macOS claims the app is "damaged". On Homebrew 5.x, skip `brew trust` (it
doesn't exist there) and use `brew install --cask --no-quarantine` instead of
the `xattr` step.

The app checks GitHub Releases on launch and updates itself in the background
(restart from Settings when prompted) — no `brew upgrade` needed. You can also
grab the `.dmg` directly from
[Releases](https://github.com/inkitori/soundcloud-desktop/releases).

Optional: `brew install ffmpeg` enables offline downloads as `.m4a` (without it,
downloads are stored as raw fMP4, which usually still plays).

## Developing

```sh
pnpm install
pnpm tauri dev      # development
pnpm tauri build    # produces the .app under src-tauri/target/release/bundle/macOS/
```

Requirements: Rust, Node + pnpm.

### Releasing

Releases are built and published by CI (`.github/workflows/release.yml`) on a
tag push:

```sh
scripts/release.sh 0.2.0     # bumps package.json / tauri.conf.json / Cargo.toml+lock, commits, tags
git push origin main v0.2.0
```

CI builds a universal (Intel + Apple Silicon) macOS app, signs the updater
artifacts, publishes a GitHub Release with the `.dmg` + `latest.json` update
manifest, and bumps the cask in
[inkitori/homebrew-tap](https://github.com/inkitori/homebrew-tap).

Two repo secrets drive this: `TAURI_SIGNING_PRIVATE_KEY` (updater signing key —
the local copy lives at `~/.tauri/soundcloud-desktop.key`; if it's lost,
existing installs can never verify another update) and `TAP_DEPLOY_KEY` (SSH
deploy key with write access to the tap repo).

## Connecting your account

Click **Sign in with SoundCloud** on first run: a SoundCloud sign-in window
opens, you log in like normal, and it closes by itself once the app has
captured the session (stored in the app's local data folder). The same window also
yields a DataDome clearance cookie, which is what unblocks likes, reposts and
playlist edits.

When the session expires (or SoundCloud's bot protection starts blocking
writes), the app shows a dialog — **Sign in again** reopens the window, which
usually closes within seconds because the webview still has a live SoundCloud
session.

Manual fallback: both the `oauth_token` and `datadome` cookies can still be
pasted by hand (connect screen → "Sign in manually", or Settings → Advanced)
— copy them from your browser's DevTools → Cookies → soundcloud.com.

## How it works / maintenance notes

This is an unofficial client; SoundCloud can change the internal API at any time.
Known moving parts, and where they're handled:

- **client_id** is scraped from soundcloud.com's JS bundles
  (`src-tauri/src/sc/client_id.rs`) and auto-refreshed on any 401/403.
- **Stream URLs** must be resolved per-play: each transcoding resolve requires the
  track's `track_authorization` JWT, and the returned CDN URL is signed and expires
  (observed ~2h in mid-2026; historically as little as 5 min). The player
  re-resolves and seek-restores automatically on failure
  (`src/player/audioController.ts`).
- Some transcodings (e.g. `abr_sq`) return 404 on free accounts — the resolver
  falls through candidates by quality (`src-tauri/src/media/resolver.rs`).
- **Write-op endpoint shapes** (`PUT /users/{me}/track_likes/{id}`,
  `PUT /playlists/{id}` with a full track-id array, `PUT /me/track_reposts/{id}`,
  `POST /me/followings/{id}`, `POST /playlists` for creation) follow the web
  app's known patterns but were not verified against a live account at build
  time. If a write fails, capture the exact request on soundcloud.com via
  DevTools → Network and adjust `src-tauri/src/sc/endpoints.rs`.
- **Rate limiting**: a global ~800ms gap between api-v2 calls; 429s honor
  Retry-After with backoff.

Downloads live in `~/Library/Application Support/com.enyouki.soundcloud/`
(`audio/` + `cache.db`). Downloading streams is against SoundCloud's ToS — this
app is for personal use.

## Keyboard

- `Space` — play/pause
- `Shift+→` / `Shift+←` — next / previous
