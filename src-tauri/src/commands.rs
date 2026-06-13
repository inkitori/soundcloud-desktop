use std::sync::Arc;

use futures::future::join_all;
use tauri::{AppHandle, State};

use crate::error::{AppError, Result};
use crate::media::cache::{CacheDb, CacheStats, CachedRow};
use crate::media::discord::{DiscordHandle, DiscordUpdate};
use crate::media::downloader::{self, DownloadManager};
use crate::media::nowplaying::{NpHandle, NpUpdate};
use crate::media::resolver::{self, PlaybackSource};
use crate::sc::client::ScClient;
use crate::sc::models::*;
use crate::sc::pagination::Page;

type Sc<'a> = State<'a, Arc<ScClient>>;
type Cache<'a> = State<'a, Arc<CacheDb>>;
type Dm<'a> = State<'a, Arc<DownloadManager>>;

// ---- auth ----

#[tauri::command]
pub async fn auth_status(sc: Sc<'_>) -> Result<AuthStatus> {
    let datadome_set = sc.has_datadome().await;
    if !sc.has_token().await {
        return Ok(AuthStatus {
            logged_in: false,
            me: None,
            datadome_set,
        });
    }
    match sc.ep_me().await {
        Ok(me) => {
            sc.set_me(me.id).await;
            Ok(AuthStatus {
                logged_in: true,
                me: Some(me),
                datadome_set,
            })
        }
        Err(AppError::TokenExpired) => Ok(AuthStatus {
            logged_in: false,
            me: None,
            datadome_set,
        }),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn auth_set_datadome(sc: Sc<'_>, cookie: String) -> Result<()> {
    sc.set_datadome(if cookie.trim().is_empty() {
        None
    } else {
        Some(cookie)
    })
    .await;
    Ok(())
}

#[tauri::command]
pub async fn auth_set_token(sc: Sc<'_>, token: String) -> Result<User> {
    let prev = sc.token().await;
    sc.set_token(Some(token)).await;
    match sc.ep_me().await {
        Ok(me) => {
            sc.set_me(me.id).await;
            Ok(me)
        }
        Err(e) => {
            sc.set_token(prev).await;
            Err(match e {
                AppError::TokenExpired => AppError::Other(
                    "token was rejected by SoundCloud — re-copy it from your browser".into(),
                ),
                other => other,
            })
        }
    }
}

#[tauri::command]
pub async fn auth_clear_token(sc: Sc<'_>) -> Result<()> {
    sc.set_token(None).await;
    Ok(())
}

#[tauri::command]
pub async fn login_start(app: AppHandle, sc: Sc<'_>) -> Result<()> {
    crate::sc::login::start(app, Arc::clone(&sc))
}

#[tauri::command]
pub async fn login_cancel(app: AppHandle) -> Result<()> {
    crate::sc::login::cancel(&app);
    Ok(())
}

// ---- read endpoints ----

#[tauri::command]
pub async fn get_stream(sc: Sc<'_>, next_href: Option<String>) -> Result<Page<FeedItem>> {
    sc.ep_stream(next_href).await
}

#[tauri::command]
pub async fn get_my_likes(sc: Sc<'_>, next_href: Option<String>) -> Result<Page<LikeItem>> {
    sc.ep_my_likes(next_href).await
}

#[tauri::command]
pub async fn get_my_playlists(sc: Sc<'_>, next_href: Option<String>) -> Result<Page<Playlist>> {
    sc.ep_my_playlists(next_href).await
}

#[tauri::command]
pub async fn get_playlist(sc: Sc<'_>, id: u64) -> Result<Playlist> {
    sc.ep_playlist(id).await
}

#[tauri::command]
pub async fn get_track(sc: Sc<'_>, id: u64) -> Result<Track> {
    sc.ep_track(id).await
}

#[tauri::command]
pub async fn get_tracks_by_ids(sc: Sc<'_>, ids: Vec<u64>) -> Result<Vec<Track>> {
    let mut out = Vec::with_capacity(ids.len());
    let chunks = ids.chunks(50).map(|chunk| sc.ep_tracks_by_ids(chunk));
    for result in join_all(chunks).await {
        out.extend(result?);
    }
    Ok(out)
}

#[tauri::command]
pub async fn get_user(sc: Sc<'_>, id: u64) -> Result<User> {
    sc.ep_user(id).await
}

#[tauri::command]
pub async fn get_user_tracks(
    sc: Sc<'_>,
    id: u64,
    next_href: Option<String>,
) -> Result<Page<Track>> {
    sc.ep_user_tracks(id, next_href).await
}

#[tauri::command]
pub async fn get_user_toptracks(
    sc: Sc<'_>,
    id: u64,
    next_href: Option<String>,
) -> Result<Page<Track>> {
    sc.ep_user_toptracks(id, next_href).await
}

#[tauri::command]
pub async fn get_user_likes(
    sc: Sc<'_>,
    id: u64,
    next_href: Option<String>,
) -> Result<Page<LikeItem>> {
    sc.ep_user_likes(id, next_href).await
}

#[tauri::command]
pub async fn get_user_playlists(
    sc: Sc<'_>,
    id: u64,
    next_href: Option<String>,
) -> Result<Page<Playlist>> {
    sc.ep_user_playlists(id, next_href).await
}

#[tauri::command]
pub async fn get_user_albums(
    sc: Sc<'_>,
    id: u64,
    next_href: Option<String>,
) -> Result<Page<Playlist>> {
    sc.ep_user_albums(id, next_href).await
}

#[tauri::command]
pub async fn get_user_reposts(
    sc: Sc<'_>,
    id: u64,
    next_href: Option<String>,
) -> Result<Page<FeedItem>> {
    sc.ep_user_reposts(id, next_href).await
}

#[tauri::command]
pub async fn get_user_followers(
    sc: Sc<'_>,
    id: u64,
    next_href: Option<String>,
) -> Result<Page<User>> {
    sc.ep_user_followers(id, next_href).await
}

#[tauri::command]
pub async fn get_user_followings(
    sc: Sc<'_>,
    id: u64,
    next_href: Option<String>,
) -> Result<Page<User>> {
    sc.ep_user_followings(id, next_href).await
}

/// Fetch the full id sets for likes/reposts/followings. Each set degrades to
/// empty on failure so one flaky endpoint doesn't blank the others.
#[tauri::command]
pub async fn get_social_ids(sc: Sc<'_>) -> Result<SocialIds> {
    let (liked_tracks, liked_playlists, reposted_tracks, reposted_playlists, followed_users) = futures::join!(
        sc.ep_my_ids("track_likes"),
        sc.ep_my_ids("playlist_likes"),
        sc.ep_my_ids("track_reposts"),
        sc.ep_my_ids("playlist_reposts"),
        sc.ep_my_following_ids(),
    );

    Ok(SocialIds {
        liked_tracks: liked_tracks.unwrap_or_default(),
        liked_playlists: liked_playlists.unwrap_or_default(),
        reposted_tracks: reposted_tracks.unwrap_or_default(),
        reposted_playlists: reposted_playlists.unwrap_or_default(),
        followed_users: followed_users.unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn get_related_tracks(
    sc: Sc<'_>,
    track_id: u64,
    next_href: Option<String>,
) -> Result<Page<Track>> {
    sc.ep_related(track_id, next_href).await
}

#[tauri::command]
pub async fn search_tracks(
    sc: Sc<'_>,
    q: String,
    next_href: Option<String>,
) -> Result<Page<Track>> {
    sc.ep_search_tracks(&q, next_href).await
}

#[tauri::command]
pub async fn search_users(sc: Sc<'_>, q: String, next_href: Option<String>) -> Result<Page<User>> {
    sc.ep_search_users(&q, next_href).await
}

#[tauri::command]
pub async fn search_playlists(
    sc: Sc<'_>,
    q: String,
    next_href: Option<String>,
) -> Result<Page<Playlist>> {
    sc.ep_search_playlists(&q, next_href).await
}

#[tauri::command]
pub async fn resolve_url(sc: Sc<'_>, url: String) -> Result<ResolvedEntity> {
    sc.ep_resolve(&url).await
}

#[tauri::command]
pub async fn get_waveform(sc: Sc<'_>, url: String) -> Result<Waveform> {
    sc.ep_waveform(&url).await
}

// ---- playback ----

#[tauri::command]
pub async fn get_playback_source(
    sc: Sc<'_>,
    cache: Cache<'_>,
    track: Track,
    force_refresh: bool,
) -> Result<PlaybackSource> {
    resolver::get_playback_source(&sc, &cache, track, force_refresh).await
}

#[tauri::command]
pub async fn note_played(cache: Cache<'_>, track_id: u64) -> Result<()> {
    cache.touch_played(track_id);
    Ok(())
}

// ---- write ops ----

#[tauri::command]
pub async fn like_track(sc: Sc<'_>, track_id: u64) -> Result<()> {
    sc.ep_set_track_like(track_id, true).await
}

#[tauri::command]
pub async fn unlike_track(sc: Sc<'_>, track_id: u64) -> Result<()> {
    sc.ep_set_track_like(track_id, false).await
}

#[tauri::command]
pub async fn like_playlist(sc: Sc<'_>, playlist_id: u64) -> Result<()> {
    sc.ep_set_playlist_like(playlist_id, true).await
}

#[tauri::command]
pub async fn unlike_playlist(sc: Sc<'_>, playlist_id: u64) -> Result<()> {
    sc.ep_set_playlist_like(playlist_id, false).await
}

#[tauri::command]
pub async fn playlist_add_track(sc: Sc<'_>, playlist_id: u64, track_id: u64) -> Result<()> {
    sc.ep_playlist_add_track(playlist_id, track_id).await
}

#[tauri::command]
pub async fn playlist_remove_track(sc: Sc<'_>, playlist_id: u64, track_id: u64) -> Result<()> {
    sc.ep_playlist_remove_track(playlist_id, track_id).await
}

#[tauri::command]
pub async fn create_playlist(
    sc: Sc<'_>,
    title: String,
    is_public: bool,
    track_ids: Vec<u64>,
) -> Result<Playlist> {
    sc.ep_create_playlist(&title, is_public, track_ids).await
}

#[tauri::command]
pub async fn repost_track(sc: Sc<'_>, track_id: u64) -> Result<()> {
    sc.ep_set_track_repost(track_id, true).await
}

#[tauri::command]
pub async fn unrepost_track(sc: Sc<'_>, track_id: u64) -> Result<()> {
    sc.ep_set_track_repost(track_id, false).await
}

#[tauri::command]
pub async fn repost_playlist(sc: Sc<'_>, playlist_id: u64) -> Result<()> {
    sc.ep_set_playlist_repost(playlist_id, true).await
}

#[tauri::command]
pub async fn unrepost_playlist(sc: Sc<'_>, playlist_id: u64) -> Result<()> {
    sc.ep_set_playlist_repost(playlist_id, false).await
}

#[tauri::command]
pub async fn follow_user(sc: Sc<'_>, user_id: u64) -> Result<()> {
    sc.ep_set_follow(user_id, true).await
}

#[tauri::command]
pub async fn unfollow_user(sc: Sc<'_>, user_id: u64) -> Result<()> {
    sc.ep_set_follow(user_id, false).await
}

// ---- downloads / cache ----

#[tauri::command]
pub async fn download_track(
    app: AppHandle,
    sc: Sc<'_>,
    cache: Cache<'_>,
    dm: Dm<'_>,
    track_id: u64,
    pin: bool,
) -> Result<()> {
    let sc = Arc::clone(&sc);
    let cache = Arc::clone(&cache);
    let dm = Arc::clone(&dm);
    tauri::async_runtime::spawn(downloader::run_download(app, sc, cache, dm, track_id, pin));
    Ok(())
}

/// Batch download (a playlist, album, or a page of likes). Each track is
/// spawned independently and queues on the DownloadManager's concurrency
/// semaphore; per-track outcomes still arrive via download:done / download:error
/// so the frontend can tally a summary.
#[tauri::command]
pub async fn download_many(
    app: AppHandle,
    sc: Sc<'_>,
    cache: Cache<'_>,
    dm: Dm<'_>,
    track_ids: Vec<u64>,
    pin: bool,
) -> Result<()> {
    for track_id in track_ids {
        let sc = Arc::clone(&sc);
        let cache = Arc::clone(&cache);
        let dm = Arc::clone(&dm);
        let app = app.clone();
        tauri::async_runtime::spawn(downloader::run_download(app, sc, cache, dm, track_id, pin));
    }
    Ok(())
}

#[tauri::command]
pub async fn cancel_download(dm: Dm<'_>, track_id: u64) -> Result<()> {
    dm.cancel(track_id);
    Ok(())
}

#[tauri::command]
pub async fn remove_download(cache: Cache<'_>, track_id: u64) -> Result<()> {
    cache.remove(track_id)
}

#[tauri::command]
pub async fn set_pinned(cache: Cache<'_>, track_id: u64, pinned: bool) -> Result<()> {
    cache.set_pinned(track_id, pinned)
}

#[tauri::command]
pub async fn list_downloads(cache: Cache<'_>) -> Result<Vec<CachedRow>> {
    cache.list()
}

/// One-time repair for downloads made before artist_id / local-art existed:
/// fetch the tracks (batched) to fill in the artist id (so artist links work)
/// and cache any missing cover art (so OS Now-Playing art works offline).
/// Returns the number of rows touched; safe to call repeatedly (idempotent).
#[tauri::command]
pub async fn backfill_downloads(sc: Sc<'_>, cache: Cache<'_>) -> Result<u64> {
    let ids = cache.ids_needing_backfill()?;
    if ids.is_empty() {
        return Ok(0);
    }
    let mut touched = 0u64;
    for chunk in ids.chunks(50) {
        let tracks = sc.ep_tracks_by_ids(chunk).await?;
        for t in tracks {
            if let Some(u) = &t.user {
                let _ = cache.set_artist_id(t.id, u.id);
            }
            if !cache.art_path(t.id).is_file() {
                if let Some(url) = t.artwork_url.as_deref() {
                    let _ = downloader::cache_artwork(&sc, &cache, t.id, url).await;
                }
            }
            touched += 1;
        }
    }
    Ok(touched)
}

#[tauri::command]
pub async fn cache_stats(cache: Cache<'_>) -> Result<CacheStats> {
    cache.stats()
}

#[tauri::command]
pub async fn set_cache_cap(cache: Cache<'_>, bytes: u64) -> Result<Vec<u64>> {
    cache.set_cap(bytes)?;
    cache.evict_to_cap()
}

// ---- now playing ----

#[tauri::command]
pub fn np_set_metadata(
    np: State<'_, NpHandle>,
    discord: State<'_, DiscordHandle>,
    title: String,
    artist: String,
    artwork_url: Option<String>,
    duration_s: f64,
    permalink_url: Option<String>,
) {
    discord.send(DiscordUpdate::Metadata {
        title: title.clone(),
        artist: artist.clone(),
        artwork_url: artwork_url.clone(),
        duration_s,
        permalink_url,
    });
    np.send(NpUpdate::Metadata {
        title,
        artist,
        artwork_url,
        duration_s,
    });
}

#[tauri::command]
pub fn np_set_playback(
    np: State<'_, NpHandle>,
    discord: State<'_, DiscordHandle>,
    playing: bool,
    position_s: f64,
) {
    discord.send(DiscordUpdate::Playback {
        playing,
        position_s,
    });
    np.send(NpUpdate::Playback {
        playing,
        position_s,
    });
}

#[tauri::command]
pub fn discord_set_enabled(discord: State<'_, DiscordHandle>, enabled: bool) {
    discord.send(DiscordUpdate::Enabled(enabled));
}
