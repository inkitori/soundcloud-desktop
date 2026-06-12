mod commands;
mod error;
mod media;
mod sc;

use std::sync::Arc;

use tauri::Manager;

use media::cache::CacheDb;
use media::downloader::DownloadManager;
use sc::client::ScClient;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::fmt().try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(ScClient::new(handle.clone()));

            let data_dir = app.path().app_data_dir()?;
            let cache = CacheDb::init(&data_dir)
                .map_err(|e| std::io::Error::other(e.to_string()))?;
            app.manage(Arc::new(cache));
            app.manage(Arc::new(DownloadManager::default()));
            app.manage(media::nowplaying::spawn(handle));
            app.manage(media::discord::spawn());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth_status,
            commands::auth_set_token,
            commands::auth_clear_token,
            commands::auth_set_datadome,
            commands::login_start,
            commands::login_cancel,
            commands::get_stream,
            commands::get_my_likes,
            commands::get_my_playlists,
            commands::get_playlist,
            commands::get_track,
            commands::get_tracks_by_ids,
            commands::get_user,
            commands::get_user_tracks,
            commands::get_user_toptracks,
            commands::get_user_likes,
            commands::get_user_playlists,
            commands::get_user_albums,
            commands::get_user_reposts,
            commands::get_user_followers,
            commands::get_user_followings,
            commands::get_social_ids,
            commands::get_related_tracks,
            commands::search_tracks,
            commands::search_users,
            commands::search_playlists,
            commands::resolve_url,
            commands::get_waveform,
            commands::get_playback_source,
            commands::note_played,
            commands::like_track,
            commands::unlike_track,
            commands::like_playlist,
            commands::unlike_playlist,
            commands::playlist_add_track,
            commands::playlist_remove_track,
            commands::create_playlist,
            commands::repost_track,
            commands::unrepost_track,
            commands::repost_playlist,
            commands::unrepost_playlist,
            commands::follow_user,
            commands::unfollow_user,
            commands::download_track,
            commands::cancel_download,
            commands::remove_download,
            commands::set_pinned,
            commands::list_downloads,
            commands::cache_stats,
            commands::set_cache_cap,
            commands::np_set_metadata,
            commands::np_set_playback,
            commands::discord_set_enabled,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
