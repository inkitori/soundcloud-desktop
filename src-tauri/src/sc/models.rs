use serde::{Deserialize, Serialize};

// api-v2 JSON is undocumented and shape-shifts: every field except `id` is
// optional with a default so one missing field never kills deserialization.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: u64,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub permalink_url: Option<String>,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub followers_count: Option<u64>,
    #[serde(default)]
    pub followings_count: Option<u64>,
    #[serde(default)]
    pub track_count: Option<u64>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub full_name: Option<String>,
    #[serde(default)]
    pub city: Option<String>,
    #[serde(default)]
    pub verified: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Format {
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub mime_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transcoding {
    pub url: String,
    #[serde(default)]
    pub preset: Option<String>,
    #[serde(default)]
    pub snipped: bool,
    #[serde(default)]
    pub quality: Option<String>,
    #[serde(default)]
    pub format: Option<Format>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Media {
    #[serde(default)]
    pub transcodings: Vec<Transcoding>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: u64,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub permalink_url: Option<String>,
    #[serde(default)]
    pub artwork_url: Option<String>,
    #[serde(default)]
    pub duration: Option<u64>,
    #[serde(default)]
    pub full_duration: Option<u64>,
    #[serde(default)]
    pub user: Option<User>,
    #[serde(default)]
    pub media: Option<Media>,
    #[serde(default)]
    pub waveform_url: Option<String>,
    #[serde(default)]
    pub streamable: Option<bool>,
    /// "ALLOW" | "SNIP" (Go+ preview) | "BLOCK" (geo-blocked)
    #[serde(default)]
    pub policy: Option<String>,
    #[serde(default)]
    pub monetization_model: Option<String>,
    #[serde(default)]
    pub playback_count: Option<u64>,
    #[serde(default)]
    pub likes_count: Option<u64>,
    #[serde(default)]
    pub genre: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    /// JWT required as a query param when resolving transcoding URLs.
    #[serde(default)]
    pub track_authorization: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub id: u64,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub permalink_url: Option<String>,
    #[serde(default)]
    pub artwork_url: Option<String>,
    #[serde(default)]
    pub user: Option<User>,
    #[serde(default)]
    pub track_count: Option<u64>,
    #[serde(default)]
    pub tracks: Vec<Track>,
    #[serde(default)]
    pub is_album: Option<bool>,
    #[serde(default)]
    pub duration: Option<u64>,
    #[serde(default)]
    pub likes_count: Option<u64>,
    #[serde(default)]
    pub created_at: Option<String>,
}

/// One item from /stream (home feed). Kept as a tolerant struct instead of a
/// tagged enum: `type` is e.g. "track", "track-repost", "playlist",
/// "playlist-repost"; `user` is the actor (poster or reposter).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeedItem {
    #[serde(rename = "type", default)]
    pub item_type: String,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub track: Option<Track>,
    #[serde(default)]
    pub playlist: Option<Playlist>,
    #[serde(default)]
    pub user: Option<User>,
    #[serde(default)]
    pub caption: Option<String>,
}

/// One item from /users/{id}/likes: wraps either a track or a playlist.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LikeItem {
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub track: Option<Track>,
    #[serde(default)]
    pub playlist: Option<Playlist>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Waveform {
    pub width: u32,
    pub height: u32,
    pub samples: Vec<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ResolvedEntity {
    Track { track: Track },
    User { user: User },
    Playlist { playlist: Playlist },
    Unknown,
}

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

/// The id sets behind heart/repost/follow toggles, mirrored client-side so
/// every row can show its state without per-item requests.
#[derive(Debug, Clone, Serialize)]
pub struct SocialIds {
    pub liked_tracks: Vec<u64>,
    pub liked_playlists: Vec<u64>,
    pub reposted_tracks: Vec<u64>,
    pub reposted_playlists: Vec<u64>,
    pub followed_users: Vec<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthStatus {
    pub logged_in: bool,
    pub me: Option<User>,
    /// Whether a DataDome clearance cookie is stored (needed for write ops).
    pub datadome_set: bool,
}
