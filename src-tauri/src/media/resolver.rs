use serde::Serialize;

use crate::error::{AppError, Result};
use crate::media::cache::CacheDb;
use crate::sc::client::ScClient;
use crate::sc::models::{Track, Transcoding};

#[derive(Debug, Clone, Serialize)]
pub struct ResolvedStream {
    pub url: String,
    /// "hls" | "progressive"
    pub protocol: String,
    pub preset: Option<String>,
    pub quality: Option<String>,
    pub snipped: bool,
    /// Signed-URL expiry in unix ms, parsed from the `expires=` param.
    pub expires_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PlaybackSource {
    Cached {
        asset_path: String,
    },
    Stream {
        #[serde(flatten)]
        stream: ResolvedStream,
    },
}

fn quality_rank(t: &Transcoding) -> i32 {
    match t.quality.as_deref() {
        Some("hq") => 3,
        Some("sq") => 2,
        _ => 1,
    }
}

fn protocol(t: &Transcoding) -> &str {
    t.format.as_ref().map(|f| f.protocol.as_str()).unwrap_or("")
}

/// Playable transcodings, best first: non-snipped, then quality desc, then
/// progressive over HLS (single file: simpler playback and downloads).
/// Encrypted variants ("ctr-encrypted-hls" etc.) are excluded.
pub fn ordered_candidates(track: &Track) -> Vec<Transcoding> {
    let mut ts: Vec<Transcoding> = track
        .media
        .as_ref()
        .map(|m| m.transcodings.clone())
        .unwrap_or_default()
        .into_iter()
        .filter(|t| matches!(protocol(t), "hls" | "progressive"))
        .collect();
    ts.sort_by_key(|t| {
        (
            t.snipped,
            -quality_rank(t),
            if protocol(t) == "progressive" { 0 } else { 1 },
        )
    });
    ts
}

fn extract_expires(url: &str) -> Option<u64> {
    let idx = url.find("expires=")?;
    let rest = &url[idx + "expires=".len()..];
    let end = rest.find('&').unwrap_or(rest.len());
    rest[..end].parse::<u64>().ok().map(|secs| secs * 1000)
}

fn has_encrypted_transcoding(track: &Track) -> bool {
    track
        .media
        .as_ref()
        .map(|m| m.transcodings.iter().any(|t| protocol(t).contains("encrypted")))
        .unwrap_or(false)
}

/// Resolve a fresh signed stream URL for a track, falling through candidates
/// that 404 (some transcodings, e.g. abr_sq, are not resolvable on every
/// account). Requires the track's `track_authorization` JWT. Skips the rate
/// limiter so a click starts playback as fast as possible.
pub async fn resolve_stream(sc: &ScClient, track: &Track) -> Result<ResolvedStream> {
    let mut query: Vec<(&str, String)> = Vec::new();
    if let Some(ta) = &track.track_authorization {
        query.push(("track_authorization", ta.clone()));
    }

    for t in ordered_candidates(track) {
        match sc.get_value_fast(&t.url, &query).await {
            Ok(v) => {
                if let Some(url) = v.get("url").and_then(|u| u.as_str()) {
                    return Ok(ResolvedStream {
                        url: url.to_string(),
                        protocol: protocol(&t).to_string(),
                        preset: t.preset.clone(),
                        quality: t.quality.clone(),
                        snipped: t.snipped,
                        expires_at: extract_expires(url),
                    });
                }
            }
            Err(AppError::NotFound) => continue,
            Err(AppError::TokenExpired) => return Err(AppError::TokenExpired),
            Err(e) => {
                tracing::warn!("transcoding resolve failed for track {}: {e}", track.id);
                continue;
            }
        }
    }
    // Only DRM-protected (CENC/Widevine/PlayReady) tracks expose nothing but
    // encrypted AAC plus 404ing mp3 fallbacks — distinguish them so the UI can
    // say so instead of showing a generic failure.
    if has_encrypted_transcoding(track) {
        Err(AppError::DrmProtected)
    } else {
        Err(AppError::NoPlayableStream(track.id))
    }
}

/// The single playback decision: cached file first, else a freshly resolved
/// stream. `force_refresh` skips the cache (used when cached/stream playback
/// just failed and the frontend wants a clean re-resolve).
///
/// The frontend passes the full `Track` it already holds, so the common path
/// makes exactly one network call (the transcoding resolve). Only stubs — a
/// track with no `media`, e.g. an un-hydrated playlist row — fall back to
/// fetching the track first.
pub async fn get_playback_source(
    sc: &ScClient,
    cache: &CacheDb,
    track: Track,
    force_refresh: bool,
) -> Result<PlaybackSource> {
    if !force_refresh {
        if let Some(path) = cache.lookup_done(track.id) {
            return Ok(PlaybackSource::Cached {
                asset_path: path.to_string_lossy().to_string(),
            });
        }
    }
    let has_media = track
        .media
        .as_ref()
        .map(|m| !m.transcodings.is_empty())
        .unwrap_or(false);
    // Trace which resolve path a click takes (debug-level; enable with
    // RUST_LOG=debug). The error!s below fire on failure regardless, since these
    // resolve errors were previously returned silently.
    tracing::debug!(
        "resolve track {} has_media={} has_track_auth={} force_refresh={}",
        track.id,
        has_media,
        track.track_authorization.is_some(),
        force_refresh
    );
    if has_media {
        match resolve_stream(sc, &track).await {
            Ok(stream) => return Ok(PlaybackSource::Stream { stream }),
            Err(AppError::TokenExpired) => {
                tracing::error!("resolve track {} -> TokenExpired (refetch skipped)", track.id);
                return Err(AppError::TokenExpired);
            }
            Err(AppError::DrmProtected) => return Err(AppError::DrmProtected),
            // Stale client-side track JSON (rotated transcoding URLs etc.):
            // fall through to a fresh fetch and one more attempt.
            Err(e) => tracing::warn!("resolve track {} with client json failed ({e}); refetching", track.id),
        }
    }
    let fresh = match sc.ep_track(track.id).await {
        Ok(f) => f,
        Err(e) => {
            tracing::error!("refetch track {} failed: {e}", track.id);
            return Err(e);
        }
    };
    tracing::info!(
        "refetched track {} has_media={} has_track_auth={}",
        fresh.id,
        fresh.media.as_ref().map(|m| !m.transcodings.is_empty()).unwrap_or(false),
        fresh.track_authorization.is_some()
    );
    let stream = match resolve_stream(sc, &fresh).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("resolve track {} after refetch failed: {e}", fresh.id);
            return Err(e);
        }
    };
    Ok(PlaybackSource::Stream { stream })
}
