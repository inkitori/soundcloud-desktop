use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use discord_rich_presence::activity::{Activity, ActivityType, Assets, Button, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};

/// Discord application ID (public, not a secret). The application's name on
/// the Discord developer portal is what renders as "Listening to <name>".
const DISCORD_APP_ID: &str = "1514618348967559228";
/// After a failed connect, don't retry until this much time has passed
/// (Discord may simply not be running).
const RECONNECT_COOLDOWN: Duration = Duration::from_secs(15);
/// Steady-state playback pings within this drift of the predicted position
/// are no-ops; larger jumps mean a seek, which re-syncs timestamps.
const DRIFT_TOLERANCE_S: f64 = 2.0;
/// Discord drops presence updates beyond ~5 per 20s, and a dropped update
/// pins a stale activity. Keep writes under the limit; a burst of changes
/// collapses into one trailing reconcile at the gap boundary.
const MIN_SEND_GAP: Duration = Duration::from_secs(5);
/// Grace before clearing on pause, so a track skip (pause→play within ~1s)
/// transitions in place instead of blanking the presence and re-setting it.
const PAUSE_LINGER: Duration = Duration::from_secs(2);

pub enum DiscordUpdate {
    Metadata {
        title: String,
        artist: String,
        artwork_url: Option<String>,
        duration_s: f64,
        permalink_url: Option<String>,
    },
    Playback { playing: bool, position_s: f64 },
    Enabled(bool),
}

pub struct DiscordHandle(Mutex<Sender<DiscordUpdate>>);

impl DiscordHandle {
    pub fn send(&self, update: DiscordUpdate) {
        if let Ok(tx) = self.0.lock() {
            let _ = tx.send(update);
        }
    }
}

struct Meta {
    title: String,
    artist: String,
    artwork_url: Option<String>,
    duration_s: f64,
    permalink_url: Option<String>,
}

struct Presence {
    client: Option<DiscordIpcClient>,
    cooldown_until: Option<Instant>,
    enabled: bool,
    meta: Option<Meta>,
    playing: bool,
    position_s: f64,
    position_at: Instant,
    /// Metadata changed since the last successful set_activity.
    dirty: bool,
    /// An activity is currently displayed on Discord.
    shown: bool,
    /// When to reconcile Discord with the current state; None = in sync.
    /// Always sent through the rate-limit clamp in `schedule_sync`.
    sync_at: Option<Instant>,
    last_sent_at: Option<Instant>,
}

/// Discord Rich Presence ("Listening to …" with a live progress bar) on a
/// dedicated thread; the IPC socket client is blocking. Presence is cleared
/// on pause, like Spotify's integration.
///
/// Updates are not pushed write-per-event: state changes schedule a
/// reconcile, and the loop below wakes at the deadline to assert whatever
/// the state is *then*. Discord silently drops bursty updates, so the
/// trailing sync is what guarantees scrubbing/skipping converges to the
/// right display.
pub fn spawn() -> DiscordHandle {
    let (tx, rx) = channel::<DiscordUpdate>();

    std::thread::spawn(move || {
        let mut p = Presence {
            client: None,
            cooldown_until: None,
            enabled: true,
            meta: None,
            playing: false,
            position_s: 0.0,
            position_at: Instant::now(),
            dirty: false,
            shown: false,
            sync_at: None,
            last_sent_at: None,
        };
        loop {
            let received = match p.sync_at {
                Some(at) => match rx.recv_timeout(at.saturating_duration_since(Instant::now())) {
                    Ok(update) => Some(update),
                    Err(RecvTimeoutError::Timeout) => None,
                    Err(RecvTimeoutError::Disconnected) => break,
                },
                None => match rx.recv() {
                    Ok(update) => Some(update),
                    Err(_) => break,
                },
            };
            match received {
                Some(update) => p.handle(update),
                None => p.sync_now(),
            }
        }
    });

    DiscordHandle(Mutex::new(tx))
}

impl Presence {
    fn handle(&mut self, update: DiscordUpdate) {
        match update {
            DiscordUpdate::Metadata {
                title,
                artist,
                artwork_url,
                duration_s,
                permalink_url,
            } => {
                self.meta = Some(Meta {
                    title,
                    artist,
                    artwork_url,
                    duration_s,
                    permalink_url,
                });
                // Don't schedule yet: a track change always lands a Playback
                // update (the audio element's play event) with the position.
                self.dirty = true;
            }
            DiscordUpdate::Playback { playing, position_s } => {
                let predicted = self.predicted_position();
                let was_playing = self.playing;
                self.playing = playing;
                self.position_s = position_s;
                self.position_at = Instant::now();
                if !self.enabled {
                    return;
                }
                if playing {
                    let seeked = (position_s - predicted).abs() > DRIFT_TOLERANCE_S;
                    if self.dirty || !was_playing || !self.shown || seeked {
                        self.schedule_sync(Duration::ZERO);
                    }
                } else if self.shown {
                    self.schedule_sync(PAUSE_LINGER);
                }
            }
            DiscordUpdate::Enabled(enabled) => {
                self.enabled = enabled;
                if !enabled {
                    // Explicit user action: clear right away, rate limit be
                    // damned, and drop the socket (which also clears).
                    self.sync_now();
                    self.client = None;
                } else if self.playing {
                    self.schedule_sync(Duration::ZERO);
                }
            }
        }
    }

    /// Ask for a reconcile no sooner than `delay`, clamped to the send rate
    /// limit. An earlier already-scheduled reconcile wins.
    fn schedule_sync(&mut self, delay: Duration) {
        let mut at = Instant::now() + delay;
        if let Some(sent) = self.last_sent_at {
            at = at.max(sent + MIN_SEND_GAP);
        }
        self.sync_at = Some(self.sync_at.map_or(at, |cur| cur.min(at)));
    }

    /// Make Discord match the current state: an activity if playing, nothing
    /// otherwise. Always called with fresh extrapolated timestamps, so it is
    /// safe (and self-correcting) to run after any burst of changes.
    fn sync_now(&mut self) {
        self.sync_at = None;
        if self.enabled && self.playing && self.meta.is_some() {
            if !self.push() {
                self.schedule_sync(Duration::ZERO); // clamps to the rate limit
            }
        } else if self.shown {
            self.clear();
        }
    }

    /// Where playback should be now, extrapolated from the last report.
    fn predicted_position(&self) -> f64 {
        if self.playing {
            self.position_s + self.position_at.elapsed().as_secs_f64()
        } else {
            self.position_s
        }
    }

    fn ensure_client(&mut self) -> bool {
        if self.client.is_some() {
            return true;
        }
        if let Some(until) = self.cooldown_until {
            if Instant::now() < until {
                return false;
            }
        }
        remove_stale_sockets();
        let mut client = DiscordIpcClient::new(DISCORD_APP_ID);
        match client.connect() {
            Ok(()) => {
                self.client = Some(client);
                self.cooldown_until = None;
                true
            }
            Err(e) => {
                tracing::debug!("discord rpc connect failed: {e}");
                self.cooldown_until = Some(Instant::now() + RECONNECT_COOLDOWN);
                false
            }
        }
    }

    fn push(&mut self) -> bool {
        self.last_sent_at = Some(Instant::now());
        if self.meta.is_none() || !self.ensure_client() {
            return false;
        }
        if self.try_set_activity().is_ok() {
            self.shown = true;
            self.dirty = false;
            return true;
        }
        // Stale socket (Discord restarted): one fresh connect, then back off.
        self.client = None;
        if self.ensure_client() && self.try_set_activity().is_ok() {
            self.shown = true;
            self.dirty = false;
            return true;
        }
        self.client = None;
        self.cooldown_until = Some(Instant::now() + RECONNECT_COOLDOWN);
        self.shown = false;
        false
    }

    fn try_set_activity(&mut self) -> Result<(), ()> {
        let position_s = self.predicted_position();
        let (Some(meta), Some(client)) = (self.meta.as_ref(), self.client.as_mut()) else {
            return Err(());
        };
        let details = clamp_text(&meta.title);
        let state = clamp_text(&meta.artist);

        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        let start_ms = now_ms - (position_s * 1000.0) as i64;
        let mut timestamps = Timestamps::new().start(start_ms);
        if meta.duration_s > 0.5 {
            timestamps = timestamps.end(start_ms + (meta.duration_s * 1000.0) as i64);
        }

        let mut activity = Activity::new()
            .activity_type(ActivityType::Listening)
            .details(details.as_str())
            .state(state.as_str())
            .timestamps(timestamps);
        if let Some(url) = meta.artwork_url.as_deref() {
            activity = activity.assets(Assets::new().large_image(url).large_text(details.as_str()));
        }
        if let Some(url) = meta.permalink_url.as_deref() {
            activity = activity.buttons(vec![Button::new("Listen on SoundCloud", url)]);
        }

        client.set_activity(activity).map_err(|e| {
            tracing::debug!("discord rpc set_activity failed: {e}");
        })
    }

    fn clear(&mut self) {
        self.shown = false;
        self.last_sent_at = Some(Instant::now());
        if let Some(client) = self.client.as_mut() {
            // A failed clear means a dead socket; dropping it clears anyway.
            if client.clear_activity().is_err() {
                self.client = None;
            }
        }
    }
}

/// A crashed Discord can leave dead `discord-ipc-N` socket files behind, and
/// the client library connects to the first file that *exists* — a dead
/// `discord-ipc-0` masks a live `discord-ipc-1`. Refused connection means no
/// listener, so the file is safe to delete; Discord recreates it on launch.
#[cfg(unix)]
fn remove_stale_sockets() {
    use std::io::ErrorKind;
    use std::os::unix::net::UnixStream;
    for key in ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"] {
        let Ok(base) = std::env::var(key) else { continue };
        for i in 0..10 {
            let path = std::path::Path::new(&base).join(format!("discord-ipc-{i}"));
            if !path.exists() {
                continue;
            }
            match UnixStream::connect(&path) {
                Err(e) if e.kind() == ErrorKind::ConnectionRefused => {
                    if std::fs::remove_file(&path).is_ok() {
                        tracing::info!("removed stale discord ipc socket {}", path.display());
                    }
                }
                _ => {}
            }
        }
    }
}

#[cfg(not(unix))]
fn remove_stale_sockets() {}

/// Discord requires details/state to be 2..=128 chars.
fn clamp_text(s: &str) -> String {
    let mut out: String = s.chars().take(128).collect();
    while out.chars().count() < 2 {
        out.push(' ');
    }
    out
}
