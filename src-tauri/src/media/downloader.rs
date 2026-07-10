use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use futures::future::join_all;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio::sync::Semaphore;

use crate::error::{AppError, Result};
use crate::media::cache::{CacheDb, CachedRow};
use crate::media::resolver::{resolve_stream, ResolvedStream};
use crate::sc::client::ScClient;
use crate::sc::models::Track;

const SEGMENT_CONCURRENCY: usize = 4;
/// Whole-track downloads that may run at once. Bounds batch ("download all")
/// jobs so dozens of tracks don't hammer SoundCloud (and trip rate limiting);
/// the rest queue on the semaphore and start as slots free.
const MAX_CONCURRENT_DOWNLOADS: usize = 3;

pub struct DownloadManager {
    active: Mutex<HashSet<u64>>,
    cancelled: Mutex<HashSet<u64>>,
    slots: Semaphore,
}

impl Default for DownloadManager {
    fn default() -> Self {
        Self {
            active: Mutex::new(HashSet::new()),
            cancelled: Mutex::new(HashSet::new()),
            slots: Semaphore::new(MAX_CONCURRENT_DOWNLOADS),
        }
    }
}

impl DownloadManager {
    /// Reserve the track; false means it's already queued or downloading.
    fn begin(&self, track_id: u64) -> bool {
        self.cancelled.lock().unwrap().remove(&track_id);
        self.active.lock().unwrap().insert(track_id)
    }
    fn finish(&self, track_id: u64) {
        self.active.lock().unwrap().remove(&track_id);
        self.cancelled.lock().unwrap().remove(&track_id);
    }
    pub fn cancel(&self, track_id: u64) {
        self.cancelled.lock().unwrap().insert(track_id);
    }
    fn is_cancelled(&self, track_id: u64) -> bool {
        self.cancelled.lock().unwrap().contains(&track_id)
    }
}

fn emit_progress(app: &AppHandle, track_id: u64, pct: f64) {
    let _ = app.emit("download:progress", json!({ "track_id": track_id, "pct": pct }));
}

/// Entry point: spawned from the `download_track` command so the UI returns
/// immediately; outcome is delivered via download:done / download:error events.
pub async fn run_download(
    app: AppHandle,
    sc: Arc<ScClient>,
    cache: Arc<CacheDb>,
    dm: Arc<DownloadManager>,
    track_id: u64,
    pin: bool,
) {
    if !dm.begin(track_id) {
        return; // already queued or downloading
    }
    // Wait for a concurrency slot; batch jobs queue here instead of all at once.
    let _permit = match dm.slots.acquire().await {
        Ok(p) => p,
        Err(_) => {
            dm.finish(track_id);
            return;
        }
    };
    // Cancelled while it sat in the queue: report and skip the work.
    if dm.is_cancelled(track_id) {
        dm.finish(track_id);
        let _ = app.emit(
            "download:error",
            json!({ "track_id": track_id, "message": "cancelled", "code": "cancelled", "cancelled": true }),
        );
        return;
    }
    let result = download_inner(&app, &sc, &cache, &dm, track_id, pin).await;
    dm.finish(track_id);
    match result {
        Ok(row) => {
            let evicted = cache.evict_to_cap().unwrap_or_default();
            let _ = app.emit(
                "download:done",
                json!({ "track_id": track_id, "bytes": row.bytes, "evicted": evicted }),
            );
        }
        Err(e) => {
            let cancelled = dm.is_cancelled(track_id) || matches!(e, AppError::Other(ref m) if m == "cancelled");
            let _ = app.emit(
                "download:error",
                json!({
                    "track_id": track_id,
                    "message": e.to_string(),
                    "code": e.code(),
                    "cancelled": cancelled,
                }),
            );
        }
    }
}

async fn download_inner(
    app: &AppHandle,
    sc: &ScClient,
    cache: &CacheDb,
    dm: &DownloadManager,
    track_id: u64,
    pin: bool,
) -> Result<CachedRow> {
    let track = sc.ep_track(track_id).await?;
    let stream = resolve_stream(sc, &track).await?;
    if stream.snipped {
        return Err(AppError::PreviewOnly);
    }

    let part_path = cache.tmp_dir.join(format!("{track_id}.part"));
    match stream.protocol.as_str() {
        "progressive" => download_progressive(app, sc, dm, track_id, &stream.url, &part_path).await?,
        "hls" => download_hls(app, sc, dm, &track, track_id, &stream, &part_path).await?,
        p => return Err(AppError::Other(format!("unsupported protocol {p}"))),
    }

    if dm.is_cancelled(track_id) {
        let _ = tokio::fs::remove_file(&part_path).await;
        return Err(AppError::Other("cancelled".into()));
    }

    // Finalize: progressive mp3 needs no remux; HLS fMP4 gets remuxed to a
    // flat .m4a when ffmpeg is available (falls back to raw fMP4, which
    // AVFoundation can usually play).
    let is_mp3 = stream
        .preset
        .as_deref()
        .map(|p| p.starts_with("mp3"))
        .unwrap_or(false);
    let file_name = if stream.protocol == "progressive" && is_mp3 {
        format!("{track_id}.mp3")
    } else {
        format!("{track_id}.m4a")
    };
    let final_path = cache.audio_dir.join(&file_name);

    if stream.protocol == "hls" {
        match remux_with_ffmpeg(&part_path, &final_path).await {
            Ok(()) => {
                let _ = tokio::fs::remove_file(&part_path).await;
            }
            Err(e) => {
                tracing::warn!("ffmpeg remux failed ({e}); storing raw fMP4");
                tokio::fs::rename(&part_path, &final_path).await?;
            }
        }
    } else {
        tokio::fs::rename(&part_path, &final_path).await?;
    }

    // Best-effort cover-art cache so the offline library isn't all gray
    // squares; a failure here must not fail the (already complete) download.
    if let Some(url) = track.artwork_url.as_deref() {
        if let Err(e) = cache_artwork(sc, cache, track_id, url).await {
            tracing::warn!("artwork cache failed for {track_id}: {e}");
        }
    }
    // Same for the waveform JSON, so the scrubber has bars offline.
    if let Some(url) = track.waveform_url.as_deref() {
        if let Err(e) = cache_waveform(sc, cache, track_id, url).await {
            tracing::warn!("waveform cache failed for {track_id}: {e}");
        }
    }

    let bytes = tokio::fs::metadata(&final_path).await?.len();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let row = CachedRow {
        track_id,
        file_name,
        title: track.title.clone(),
        artist: track.user.as_ref().and_then(|u| u.username.clone()),
        artist_id: track.user.as_ref().map(|u| u.id),
        artwork_url: track.artwork_url.clone(),
        duration_ms: track.duration,
        preset: stream.preset.clone(),
        bytes,
        pinned: pin,
        downloaded_at: now,
        last_played_at: now,
        art_path: None,
    };
    cache.insert_done(&row)?;
    Ok(row)
}

/// Fetch a track's cover art into the cache (as `{track_id}.jpg`). SoundCloud
/// artwork URLs embed their size, so upgrade the `-large` thumbnail to 500x500.
pub(crate) async fn cache_artwork(sc: &ScClient, cache: &CacheDb, track_id: u64, url: &str) -> Result<()> {
    let big = url.replace("-large.", "-t500x500.");
    let resp = sc.http.get(&big).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::Other(format!("artwork HTTP {}", resp.status())));
    }
    let bytes = resp.bytes().await?;
    write_file(&cache.art_path(track_id), &bytes).await?;
    Ok(())
}

/// Fetch a track's waveform JSON into the cache (as `waves/{track_id}.json`).
pub(crate) async fn cache_waveform(
    sc: &ScClient,
    cache: &CacheDb,
    track_id: u64,
    waveform_url: &str,
) -> Result<()> {
    let wave = sc.ep_waveform(waveform_url).await?;
    let bytes = serde_json::to_vec(&wave)
        .map_err(|e| AppError::Other(format!("waveform encode: {e}")))?;
    write_file(&cache.wave_path(track_id), &bytes).await
}

async fn write_file(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = tokio::fs::File::create(path).await?;
    file.write_all(bytes).await?;
    file.flush().await?;
    Ok(())
}

async fn download_progressive(
    app: &AppHandle,
    sc: &ScClient,
    dm: &DownloadManager,
    track_id: u64,
    url: &str,
    part_path: &PathBuf,
) -> Result<()> {
    let resp = sc.http.get(url).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::Other(format!(
            "progressive download failed: HTTP {}",
            resp.status()
        )));
    }
    let total = resp.content_length();
    let mut file = tokio::fs::File::create(part_path).await?;
    let mut downloaded: u64 = 0;
    let mut resp = resp;
    while let Some(chunk) = resp.chunk().await? {
        if dm.is_cancelled(track_id) {
            return Err(AppError::Other("cancelled".into()));
        }
        file.write_all(&chunk).await?;
        downloaded += chunk.len() as u64;
        if let Some(t) = total {
            emit_progress(app, track_id, downloaded as f64 / t as f64);
        }
    }
    file.flush().await?;
    Ok(())
}

struct HlsPlaylist {
    init_url: Option<String>,
    segment_urls: Vec<String>,
}

fn parse_hls(text: &str, base_url: &str) -> Result<HlsPlaylist> {
    let (_, playlist) = m3u8_rs::parse_media_playlist(text.as_bytes())
        .map_err(|e| AppError::Other(format!("m3u8 parse failed: {e}")))?;

    let absolutize = |uri: &str| -> String {
        if uri.starts_with("http") {
            uri.to_string()
        } else {
            // Relative URI: resolve against the playlist URL's directory.
            let base = base_url.split('?').next().unwrap_or(base_url);
            match base.rfind('/') {
                Some(idx) => format!("{}/{}", &base[..idx], uri),
                None => uri.to_string(),
            }
        }
    };

    let mut init_url = None;
    let mut segment_urls = Vec::with_capacity(playlist.segments.len());
    for seg in &playlist.segments {
        if seg.key.is_some() {
            return Err(AppError::Other("stream is encrypted; skipping".into()));
        }
        if init_url.is_none() {
            if let Some(map) = &seg.map {
                init_url = Some(absolutize(&map.uri));
            }
        }
        segment_urls.push(absolutize(&seg.uri));
    }
    Ok(HlsPlaylist {
        init_url,
        segment_urls,
    })
}

async fn fetch_segment(sc: &ScClient, url: &str) -> Result<Vec<u8>> {
    let resp = sc.http.get(url).send().await?;
    let status = resp.status();
    if status == reqwest::StatusCode::FORBIDDEN {
        return Err(AppError::Other("segment 403".into()));
    }
    if !status.is_success() {
        return Err(AppError::Other(format!("segment HTTP {status}")));
    }
    Ok(resp.bytes().await?.to_vec())
}

async fn download_hls(
    app: &AppHandle,
    sc: &ScClient,
    dm: &DownloadManager,
    track: &Track,
    track_id: u64,
    stream: &ResolvedStream,
    part_path: &PathBuf,
) -> Result<()> {
    let m3u8_text = sc.fetch_text(&stream.url).await?;
    let mut playlist = parse_hls(&m3u8_text, &stream.url)?;
    let total = playlist.segment_urls.len();

    let mut file = tokio::fs::File::create(part_path).await?;
    if let Some(init) = &playlist.init_url {
        let data = fetch_segment(sc, init).await?;
        file.write_all(&data).await?;
    }

    let mut done = 0usize;
    while done < total {
        if dm.is_cancelled(track_id) {
            return Err(AppError::Other("cancelled".into()));
        }
        let chunk_end = (done + SEGMENT_CONCURRENCY).min(total);
        let batch = join_all(
            playlist.segment_urls[done..chunk_end]
                .iter()
                .map(|u| fetch_segment(sc, u)),
        )
        .await;

        let mut expired = false;
        let mut buffers = Vec::with_capacity(batch.len());
        for result in batch {
            match result {
                Ok(data) => buffers.push(data),
                Err(AppError::Other(ref m)) if m == "segment 403" => {
                    expired = true;
                    break;
                }
                Err(e) => return Err(e),
            }
        }

        if expired {
            // Signed segment URLs expired mid-download: re-resolve the
            // transcoding, re-fetch the playlist, and continue at `done`.
            tracing::info!("segment URLs expired; re-resolving playlist for {track_id}");
            let fresh = resolve_stream(sc, track).await?;
            if fresh.protocol != "hls" {
                return Err(AppError::Other("stream changed shape mid-download".into()));
            }
            let fresh_text = sc.fetch_text(&fresh.url).await?;
            let fresh_playlist = parse_hls(&fresh_text, &fresh.url)?;
            if fresh_playlist.segment_urls.len() != total {
                return Err(AppError::Other(
                    "playlist changed length mid-download; retry the download".into(),
                ));
            }
            playlist = fresh_playlist;
            continue;
        }

        for data in buffers {
            file.write_all(&data).await?;
            done += 1;
        }
        emit_progress(app, track_id, done as f64 / total as f64);
    }
    file.flush().await?;
    Ok(())
}

async fn find_ffmpeg() -> Option<String> {
    for candidate in ["ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"] {
        if tokio::process::Command::new(candidate)
            .arg("-version")
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return Some(candidate.to_string());
        }
    }
    None
}

async fn remux_with_ffmpeg(input: &PathBuf, output: &PathBuf) -> Result<()> {
    let ffmpeg = find_ffmpeg()
        .await
        .ok_or_else(|| AppError::Other("ffmpeg not found".into()))?;
    let out = tokio::process::Command::new(ffmpeg)
        .args(["-y", "-i"])
        .arg(input)
        .args(["-c", "copy", "-movflags", "+faststart"])
        .arg(output)
        .output()
        .await?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let tail: String = stderr.lines().rev().take(3).collect::<Vec<_>>().join(" | ");
        return Err(AppError::Other(format!("ffmpeg failed: {tail}")));
    }
    Ok(())
}
