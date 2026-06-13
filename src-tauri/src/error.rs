use serde::ser::{Serialize, SerializeStruct, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("SoundCloud token is missing or expired")]
    TokenExpired,
    #[error("not logged in")]
    NotLoggedIn,
    #[error("rate limited by SoundCloud, retry in {retry_after_secs}s")]
    RateLimited { retry_after_secs: u64 },
    #[error("not found")]
    NotFound,
    #[error("SoundCloud's bot protection (DataDome) blocked this request — try again to get a verification check")]
    BotChallenge,
    #[error("no playable stream for track {0}")]
    NoPlayableStream(u64),
    #[error("only a 30-second preview is available (Go+ track)")]
    PreviewOnly,
    #[error("this track is DRM-protected and can't be played outside SoundCloud")]
    DrmProtected,
    #[error("could not obtain a SoundCloud client_id")]
    ClientId,
    #[error("{0}")]
    Other(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Network(_) => "network",
            AppError::TokenExpired => "token_expired",
            AppError::NotLoggedIn => "not_logged_in",
            AppError::RateLimited { .. } => "rate_limited",
            AppError::NotFound => "not_found",
            AppError::BotChallenge => "bot_challenge",
            AppError::NoPlayableStream(_) => "no_stream",
            AppError::PreviewOnly => "preview_only",
            AppError::DrmProtected => "drm",
            AppError::ClientId => "client_id",
            AppError::Other(_) => "other",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 3)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        let retry_after = match self {
            AppError::RateLimited { retry_after_secs } => Some(*retry_after_secs),
            _ => None,
        };
        s.serialize_field("retry_after", &retry_after)?;
        s.end()
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Other(format!("io error: {e}"))
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Other(format!("cache db error: {e}"))
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
