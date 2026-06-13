use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::json;
use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
};
use tauri::{AppHandle, Emitter};

pub enum NpUpdate {
    Metadata {
        title: String,
        artist: String,
        artwork_url: Option<String>,
        duration_s: f64,
    },
    Playback {
        playing: bool,
        position_s: f64,
    },
}

pub struct NpHandle(pub Mutex<Sender<NpUpdate>>);

/// souvlaki (macOS) hard-crashes — a non-unwinding null-pointer panic that
/// aborts the whole process — if it's handed a cover URL whose image won't
/// load: it dereferences the resulting nil `NSImage`. So only ever give it
/// something that loads: a remote http(s) URL, or a `file://` for art we have
/// on disk. Tauri webview asset URLs (`asset://localhost/<encoded path>`, or
/// `http://asset.localhost/...` on Windows) are converted to `file://` when the
/// file exists, and anything else is dropped. Worst case is a missing cover,
/// never a crash.
fn os_safe_cover(url: Option<String>) -> Option<String> {
    let url = url?;
    if let Some(enc) = url
        .strip_prefix("asset://localhost/")
        .or_else(|| url.strip_prefix("http://asset.localhost/"))
    {
        let path = percent_decode(enc);
        return std::path::Path::new(&path)
            .is_file()
            .then(|| format!("file://{path}"));
    }
    if url.starts_with("http://") || url.starts_with("https://") || url.starts_with("file://") {
        Some(url)
    } else {
        None
    }
}

/// Minimal percent-decoder for Tauri's `encodeURIComponent`-built asset paths.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

impl NpHandle {
    pub fn send(&self, update: NpUpdate) {
        if let Ok(tx) = self.0.lock() {
            let _ = tx.send(update);
        }
    }
}

/// macOS Now Playing + media keys via souvlaki on a dedicated thread.
/// Tauri's NSApplication run loop satisfies souvlaki's macOS requirement;
/// remote-command events are relayed to the webview as `media:cmd`.
pub fn spawn(app: AppHandle) -> NpHandle {
    let (tx, rx) = channel::<NpUpdate>();

    std::thread::spawn(move || {
        let config = PlatformConfig {
            display_name: "SoundCloud Desktop",
            dbus_name: "soundcloud_desktop",
            hwnd: None,
        };
        let mut controls = match MediaControls::new(config) {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!("media controls unavailable: {e:?}");
                return;
            }
        };

        let emitter = app.clone();
        let attach_result = controls.attach(move |event| {
            let payload = match event {
                MediaControlEvent::Play => json!({ "action": "play" }),
                MediaControlEvent::Pause => json!({ "action": "pause" }),
                MediaControlEvent::Toggle => json!({ "action": "toggle" }),
                MediaControlEvent::Next => json!({ "action": "next" }),
                MediaControlEvent::Previous => json!({ "action": "prev" }),
                MediaControlEvent::Stop => json!({ "action": "pause" }),
                MediaControlEvent::SetPosition(MediaPosition(pos)) => {
                    json!({ "action": "seek", "position_s": pos.as_secs_f64() })
                }
                _ => return,
            };
            let _ = emitter.emit("media:cmd", payload);
        });
        if let Err(e) = attach_result {
            tracing::warn!("failed to attach media controls: {e:?}");
            return;
        }

        while let Ok(update) = rx.recv() {
            match update {
                NpUpdate::Metadata {
                    title,
                    artist,
                    artwork_url,
                    duration_s,
                } => {
                    let cover = os_safe_cover(artwork_url);
                    let _ = controls.set_metadata(MediaMetadata {
                        title: Some(&title),
                        artist: Some(&artist),
                        album: None,
                        cover_url: cover.as_deref(),
                        duration: Some(Duration::from_secs_f64(duration_s.max(0.0))),
                    });
                }
                NpUpdate::Playback { playing, position_s } => {
                    let progress = Some(MediaPosition(Duration::from_secs_f64(
                        position_s.max(0.0),
                    )));
                    let playback = if playing {
                        MediaPlayback::Playing { progress }
                    } else {
                        MediaPlayback::Paused { progress }
                    };
                    let _ = controls.set_playback(playback);
                }
            }
        }
    });

    NpHandle(Mutex::new(tx))
}
