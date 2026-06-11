use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::error::{AppError, Result};
use crate::media::cache::{CacheDb, CacheStats, CachedRow};
use crate::media::downloader::{self, DownloadManager};
use crate::media::nowplaying::{NpHandle, NpUpdate};
use crate::media::resolver::{self, PlaybackSource};
use crate::sc::client::ScClient;
use crate::sc::models::*;
use crate::sc::pagination::Page;
use crate::sc::auth;

type Sc<'a> = State<'a, Arc<ScClient>>;
type Cache<'a> = State<'a, Arc<CacheDb>>;
type Dm<'a> = State<'a, Arc<DownloadManager>>;

// ---- auth ----

#[tauri::command]
pub async fn auth_status(sc: Sc<'_>) -> Result<AuthStatus> {
    if !sc.has_token().await {
        return Ok(AuthStatus {
            logged_in: false,
            me: None,
        });
    }
    match sc.ep_me().await {
        Ok(me) => {
            sc.set_me(me.id).await;
            Ok(AuthStatus {
                logged_in: true,
                me: Some(me),
            })
        }
        Err(AppError::TokenExpired) => Ok(AuthStatus {
            logged_in: false,
            me: None,
        }),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn auth_set_token(sc: Sc<'_>, token: String) -> Result<User> {
    sc.set_token(Some(token.trim().to_string())).await;
    match sc.ep_me().await {
        Ok(me) => {
            auth::set_token(&token)?;
            sc.set_me(me.id).await;
            Ok(me)
        }
        Err(e) => {
            sc.set_token(auth::get_token()).await;
            Err(match e {
                AppError::TokenExpired => {
                    AppError::Other("token was rejected by SoundCloud — re-copy it from your browser".into())
                }
                other => other,
            })
        }
    }
}

#[tauri::command]
pub async fn auth_clear_token(sc: Sc<'_>) -> Result<()> {
    auth::clear_token()?;
    sc.set_token(None).await;
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
    for chunk in ids.chunks(50) {
        out.extend(sc.ep_tracks_by_ids(chunk).await?);
    }
    Ok(out)
}

#[tauri::command]
pub async fn get_user(sc: Sc<'_>, id: u64) -> Result<User> {
    sc.ep_user(id).await
}

#[tauri::command]
pub async fn get_user_tracks(sc: Sc<'_>, id: u64, next_href: Option<String>) -> Result<Page<Track>> {
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
pub async fn get_related_tracks(
    sc: Sc<'_>,
    track_id: u64,
    next_href: Option<String>,
) -> Result<Page<Track>> {
    sc.ep_related(track_id, next_href).await
}

#[tauri::command]
pub async fn search_tracks(sc: Sc<'_>, q: String, next_href: Option<String>) -> Result<Page<Track>> {
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
    title: String,
    artist: String,
    artwork_url: Option<String>,
    duration_s: f64,
) {
    np.send(NpUpdate::Metadata {
        title,
        artist,
        artwork_url,
        duration_s,
    });
}

#[tauri::command]
pub fn np_set_playback(np: State<'_, NpHandle>, playing: bool, position_s: f64) {
    np.send(NpUpdate::Playback {
        playing,
        position_s,
    });
}
