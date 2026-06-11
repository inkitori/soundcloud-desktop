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
                    let _ = controls.set_metadata(MediaMetadata {
                        title: Some(&title),
                        artist: Some(&artist),
                        album: None,
                        cover_url: artwork_url.as_deref(),
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
