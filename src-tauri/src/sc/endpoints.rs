use reqwest::Method;
use serde_json::{json, Value};

use super::client::ScClient;
use super::models::*;
use super::pagination::{parse_items, parse_page, Page};
use crate::error::{AppError, Result};

fn lp(limit: u32) -> Vec<(&'static str, String)> {
    vec![
        ("linked_partitioning", "1".to_string()),
        ("limit", limit.to_string()),
    ]
}

impl ScClient {
    async fn page<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        next: Option<String>,
        limit: u32,
    ) -> Result<Page<T>> {
        let v = match next {
            Some(href) => self.get_value(&href, &[]).await?,
            None => self.get_value(path, &lp(limit)).await?,
        };
        Ok(parse_page(v))
    }

    pub async fn ep_me(&self) -> Result<User> {
        self.get_json("/me", &[]).await
    }

    pub async fn ep_stream(&self, next: Option<String>) -> Result<Page<FeedItem>> {
        self.page("/stream", next, 24).await
    }

    pub async fn ep_my_likes(&self, next: Option<String>) -> Result<Page<LikeItem>> {
        match next {
            Some(href) => self.page("", Some(href), 24).await,
            None => {
                let me = self.me_id().await?;
                self.page(&format!("/users/{me}/likes"), None, 24).await
            }
        }
    }

    /// The web app's library endpoint; items wrap a `playlist` (or a
    /// `system_playlist`, which has a urn id and is skipped by lenient parse).
    pub async fn ep_my_playlists(&self, next: Option<String>) -> Result<Page<Playlist>> {
        let v = match next {
            Some(href) => self.get_value(&href, &[]).await?,
            None => {
                self.get_value(
                    "/me/library/albums_playlists_and_system_playlists",
                    &lp(24),
                )
                .await?
            }
        };
        let next_href = v
            .get("next_href")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let mut collection = Vec::new();
        if let Some(arr) = v.get("collection").and_then(Value::as_array) {
            for item in arr {
                if let Some(pv) = item.get("playlist") {
                    if let Ok(p) = serde_json::from_value::<Playlist>(pv.clone()) {
                        collection.push(p);
                    }
                }
            }
        }
        Ok(Page {
            collection,
            next_href,
        })
    }

    pub async fn ep_playlist(&self, id: u64) -> Result<Playlist> {
        self.get_json(&format!("/playlists/{id}"), &[]).await
    }

    pub async fn ep_track(&self, id: u64) -> Result<Track> {
        self.get_json(&format!("/tracks/{id}"), &[]).await
    }

    /// Hydrate playlist track stubs. Response order is not guaranteed;
    /// callers match by id. Chunked by the caller (~50 ids max per call).
    pub async fn ep_tracks_by_ids(&self, ids: &[u64]) -> Result<Vec<Track>> {
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let ids_param = ids
            .iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let v = self.get_value("/tracks", &[("ids", ids_param)]).await?;
        match v.as_array() {
            Some(arr) => Ok(parse_items(arr)),
            None => Ok(vec![]),
        }
    }

    pub async fn ep_user(&self, id: u64) -> Result<User> {
        self.get_json(&format!("/users/{id}"), &[]).await
    }

    pub async fn ep_user_tracks(&self, id: u64, next: Option<String>) -> Result<Page<Track>> {
        self.page(&format!("/users/{id}/tracks"), next, 24).await
    }

    pub async fn ep_user_toptracks(&self, id: u64, next: Option<String>) -> Result<Page<Track>> {
        self.page(&format!("/users/{id}/toptracks"), next, 24).await
    }

    pub async fn ep_user_likes(&self, id: u64, next: Option<String>) -> Result<Page<LikeItem>> {
        self.page(&format!("/users/{id}/likes"), next, 24).await
    }

    pub async fn ep_user_playlists(&self, id: u64, next: Option<String>) -> Result<Page<Playlist>> {
        self.page(&format!("/users/{id}/playlists_without_albums"), next, 24)
            .await
    }

    pub async fn ep_user_albums(&self, id: u64, next: Option<String>) -> Result<Page<Playlist>> {
        self.page(&format!("/users/{id}/albums"), next, 24).await
    }

    /// A user's reposts (the profile "Reposts" tab). Same item shape as the
    /// home feed: track-repost / playlist-repost entries.
    pub async fn ep_user_reposts(&self, id: u64, next: Option<String>) -> Result<Page<FeedItem>> {
        self.page(&format!("/stream/users/{id}/reposts"), next, 24)
            .await
    }

    /// One of the id-set endpoints the web app preloads to light up
    /// heart/repost/follow state (`/me/track_likes/ids`, `/me/track_reposts/ids`,
    /// `/me/followings/ids`, …). Pages defensively; tolerant of shape drift.
    pub async fn ep_my_ids(&self, what: &str) -> Result<Vec<u64>> {
        let mut out = Vec::new();
        let mut next: Option<String> = None;
        for _ in 0..10 {
            let v = match &next {
                Some(href) => self.get_value(href, &[]).await?,
                None => {
                    self.get_value(&format!("/me/{what}/ids"), &lp(5000))
                        .await?
                }
            };
            let items = v
                .get("collection")
                .and_then(Value::as_array)
                .cloned()
                .or_else(|| v.as_array().cloned())
                .unwrap_or_default();
            out.extend(items.iter().filter_map(Value::as_u64));
            next = v
                .get("next_href")
                .and_then(Value::as_str)
                .map(str::to_owned);
            if next.is_none() {
                break;
            }
        }
        Ok(out)
    }

    pub async fn ep_related(&self, track_id: u64, next: Option<String>) -> Result<Page<Track>> {
        self.page(&format!("/tracks/{track_id}/related"), next, 20)
            .await
    }

    pub async fn ep_search_tracks(&self, q: &str, next: Option<String>) -> Result<Page<Track>> {
        self.search_page("/search/tracks", q, next).await
    }

    pub async fn ep_search_users(&self, q: &str, next: Option<String>) -> Result<Page<User>> {
        self.search_page("/search/users", q, next).await
    }

    pub async fn ep_search_playlists(
        &self,
        q: &str,
        next: Option<String>,
    ) -> Result<Page<Playlist>> {
        self.search_page("/search/playlists", q, next).await
    }

    async fn search_page<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        q: &str,
        next: Option<String>,
    ) -> Result<Page<T>> {
        let v = match next {
            Some(href) => self.get_value(&href, &[]).await?,
            None => {
                let mut params = lp(20);
                params.push(("q", q.to_string()));
                self.get_value(path, &params).await?
            }
        };
        Ok(parse_page(v))
    }

    pub async fn ep_resolve(&self, url: &str) -> Result<ResolvedEntity> {
        let v = self.get_value("/resolve", &[("url", url.to_string())]).await?;
        let kind = v.get("kind").and_then(Value::as_str).unwrap_or("");
        let entity = match kind {
            "track" => serde_json::from_value::<Track>(v)
                .map(|track| ResolvedEntity::Track { track })
                .unwrap_or(ResolvedEntity::Unknown),
            "user" => serde_json::from_value::<User>(v)
                .map(|user| ResolvedEntity::User { user })
                .unwrap_or(ResolvedEntity::Unknown),
            "playlist" => serde_json::from_value::<Playlist>(v)
                .map(|playlist| ResolvedEntity::Playlist { playlist })
                .unwrap_or(ResolvedEntity::Unknown),
            _ => ResolvedEntity::Unknown,
        };
        Ok(entity)
    }

    pub async fn ep_waveform(&self, waveform_url: &str) -> Result<Waveform> {
        let url = if waveform_url.ends_with(".png") {
            waveform_url.replace(".png", ".json")
        } else {
            waveform_url.to_string()
        };
        let v = self.fetch_json_value(&url).await?;
        serde_path_to_error::deserialize(v)
            .map_err(|e| AppError::Other(format!("waveform decode at `{}`: {e}", e.path())))
    }

    // ---- write operations ----

    pub async fn ep_set_track_like(&self, track_id: u64, liked: bool) -> Result<()> {
        let me = self.me_id().await?;
        let method = if liked { Method::PUT } else { Method::DELETE };
        self.request_value(
            method,
            &format!("/users/{me}/track_likes/{track_id}"),
            &[],
            None,
        )
        .await?;
        Ok(())
    }

    pub async fn ep_set_playlist_like(&self, playlist_id: u64, liked: bool) -> Result<()> {
        let me = self.me_id().await?;
        let method = if liked { Method::PUT } else { Method::DELETE };
        self.request_value(
            method,
            &format!("/users/{me}/playlist_likes/{playlist_id}"),
            &[],
            None,
        )
        .await?;
        Ok(())
    }

    /// Playlist edits replace the full track-id list (the web app's shape:
    /// PUT /playlists/{id} {"playlist":{"tracks":[ids...]}}). If writes fail,
    /// re-verify the body shape against DevTools on soundcloud.com.
    pub async fn ep_playlist_set_tracks(&self, playlist_id: u64, track_ids: Vec<u64>) -> Result<()> {
        self.request_value(
            Method::PUT,
            &format!("/playlists/{playlist_id}"),
            &[],
            Some(json!({ "playlist": { "tracks": track_ids } })),
        )
        .await?;
        Ok(())
    }

    pub async fn ep_playlist_add_track(&self, playlist_id: u64, track_id: u64) -> Result<()> {
        let playlist = self.ep_playlist(playlist_id).await?;
        let mut ids: Vec<u64> = playlist.tracks.iter().map(|t| t.id).collect();
        if !ids.contains(&track_id) {
            ids.push(track_id);
            self.ep_playlist_set_tracks(playlist_id, ids).await?;
        }
        Ok(())
    }

    pub async fn ep_playlist_remove_track(&self, playlist_id: u64, track_id: u64) -> Result<()> {
        let playlist = self.ep_playlist(playlist_id).await?;
        let ids: Vec<u64> = playlist
            .tracks
            .iter()
            .map(|t| t.id)
            .filter(|id| *id != track_id)
            .collect();
        self.ep_playlist_set_tracks(playlist_id, ids).await?;
        Ok(())
    }

    /// Create a playlist (web app shape: POST /playlists
    /// {"playlist":{"title":…,"sharing":"public"|"private","tracks":[ids]}}).
    /// If creation fails, re-verify the body against DevTools on soundcloud.com.
    pub async fn ep_create_playlist(
        &self,
        title: &str,
        public: bool,
        track_ids: Vec<u64>,
    ) -> Result<Playlist> {
        let v = self
            .request_value(
                Method::POST,
                "/playlists",
                &[],
                Some(json!({
                    "playlist": {
                        "title": title,
                        "sharing": if public { "public" } else { "private" },
                        "tracks": track_ids,
                    }
                })),
            )
            .await?;
        serde_path_to_error::deserialize(v)
            .map_err(|e| AppError::Other(format!("playlist decode at `{}`: {e}", e.path())))
    }

    pub async fn ep_set_track_repost(&self, track_id: u64, on: bool) -> Result<()> {
        let method = if on { Method::PUT } else { Method::DELETE };
        self.request_value(method, &format!("/me/track_reposts/{track_id}"), &[], None)
            .await?;
        Ok(())
    }

    pub async fn ep_set_playlist_repost(&self, playlist_id: u64, on: bool) -> Result<()> {
        let method = if on { Method::PUT } else { Method::DELETE };
        self.request_value(
            method,
            &format!("/me/playlist_reposts/{playlist_id}"),
            &[],
            None,
        )
        .await?;
        Ok(())
    }

    /// Follow/unfollow (web app shape: POST/DELETE /me/followings/{id}).
    pub async fn ep_set_follow(&self, user_id: u64, on: bool) -> Result<()> {
        let method = if on { Method::POST } else { Method::DELETE };
        self.request_value(method, &format!("/me/followings/{user_id}"), &[], None)
            .await?;
        Ok(())
    }
}
