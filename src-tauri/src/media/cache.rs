use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::Result;

const DEFAULT_CAP_BYTES: u64 = 2 * 1024 * 1024 * 1024; // 2 GB

#[derive(Debug, Clone, Serialize)]
pub struct CachedRow {
    pub track_id: u64,
    pub file_name: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub artist_id: Option<u64>,
    pub artwork_url: Option<String>,
    pub duration_ms: Option<u64>,
    pub preset: Option<String>,
    pub bytes: u64,
    pub pinned: bool,
    pub downloaded_at: i64,
    pub last_played_at: i64,
    /// Absolute path to a locally-cached artwork file, computed on read (not a
    /// column). Present only when the jpg was downloaded and still exists.
    #[serde(default)]
    pub art_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CacheStats {
    pub bytes_used: u64,
    pub byte_cap: u64,
    pub count: u64,
}

pub struct CacheDb {
    conn: Mutex<Connection>,
    pub audio_dir: PathBuf,
    pub tmp_dir: PathBuf,
    /// Cached cover art, one `{track_id}.jpg` per download. Lives under
    /// `audio/` so the existing `$APPDATA/audio/**` asset-protocol scope serves
    /// it to the webview without extra config.
    pub art_dir: PathBuf,
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

impl CacheDb {
    pub fn init(data_dir: &Path) -> Result<Self> {
        let audio_dir = data_dir.join("audio");
        let tmp_dir = data_dir.join("tmp");
        let art_dir = audio_dir.join("art");
        std::fs::create_dir_all(&audio_dir)?;
        std::fs::create_dir_all(&tmp_dir)?;
        std::fs::create_dir_all(&art_dir)?;

        let conn = Connection::open(data_dir.join("cache.db"))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS tracks (
                track_id       INTEGER PRIMARY KEY,
                file_name      TEXT NOT NULL,
                title          TEXT,
                artist         TEXT,
                artwork_url    TEXT,
                duration_ms    INTEGER,
                preset         TEXT,
                bytes          INTEGER NOT NULL DEFAULT 0,
                pinned         INTEGER NOT NULL DEFAULT 0,
                downloaded_at  INTEGER NOT NULL DEFAULT 0,
                last_played_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )?;

        // Migration: artist_id was added after the first release. ALTER fails
        // (harmlessly) once the column exists, so ignore the error.
        let _ = conn.execute("ALTER TABLE tracks ADD COLUMN artist_id INTEGER", []);

        // Sweep leftovers from a previous run killed mid-download.
        if let Ok(entries) = std::fs::read_dir(&tmp_dir) {
            for entry in entries.flatten() {
                let _ = std::fs::remove_file(entry.path());
            }
        }

        Ok(Self {
            conn: Mutex::new(conn),
            audio_dir,
            tmp_dir,
            art_dir,
        })
    }

    /// Where this track's cached cover art lives (whether or not it exists yet).
    pub fn art_path(&self, track_id: u64) -> PathBuf {
        self.art_dir.join(format!("{track_id}.jpg"))
    }

    /// Path of a completed, still-present cached file; purges stale rows.
    pub fn lookup_done(&self, track_id: u64) -> Option<PathBuf> {
        let conn = self.conn.lock().unwrap();
        let file_name: Option<String> = conn
            .query_row(
                "SELECT file_name FROM tracks WHERE track_id = ?1",
                params![track_id],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten();
        let file_name = file_name?;
        let path = self.audio_dir.join(&file_name);
        if path.is_file() {
            Some(path)
        } else {
            let _ = conn.execute("DELETE FROM tracks WHERE track_id = ?1", params![track_id]);
            None
        }
    }

    pub fn insert_done(&self, row: &CachedRow) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO tracks
             (track_id, file_name, title, artist, artist_id, artwork_url, duration_ms, preset,
              bytes, pinned, downloaded_at, last_played_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![
                row.track_id,
                row.file_name,
                row.title,
                row.artist,
                row.artist_id,
                row.artwork_url,
                row.duration_ms,
                row.preset,
                row.bytes,
                row.pinned as i64,
                row.downloaded_at,
                row.last_played_at,
            ],
        )?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<CachedRow>> {
        let mut rows: Vec<CachedRow> = Vec::new();
        {
            let conn = self.conn.lock().unwrap();
            let mut stmt = conn.prepare(
                "SELECT track_id, file_name, title, artist, artist_id, artwork_url, duration_ms,
                        preset, bytes, pinned, downloaded_at, last_played_at
                 FROM tracks ORDER BY downloaded_at DESC",
            )?;
            let mapped = stmt.query_map([], |r| {
                Ok(CachedRow {
                    track_id: r.get(0)?,
                    file_name: r.get(1)?,
                    title: r.get(2)?,
                    artist: r.get(3)?,
                    artist_id: r.get(4)?,
                    artwork_url: r.get(5)?,
                    duration_ms: r.get(6)?,
                    preset: r.get(7)?,
                    bytes: r.get(8)?,
                    pinned: r.get::<_, i64>(9)? != 0,
                    downloaded_at: r.get(10)?,
                    last_played_at: r.get(11)?,
                    art_path: None,
                })
            })?;
            for row in mapped.flatten() {
                rows.push(row);
            }
        }
        // Resolve the on-disk artwork path per row (convention-based, no column).
        for row in &mut rows {
            let path = self.art_path(row.track_id);
            if path.is_file() {
                row.art_path = Some(path.to_string_lossy().to_string());
            }
        }
        Ok(rows)
    }

    pub fn remove(&self, track_id: u64) -> Result<()> {
        let file_name: Option<String> = {
            let conn = self.conn.lock().unwrap();
            let name = conn
                .query_row(
                    "SELECT file_name FROM tracks WHERE track_id = ?1",
                    params![track_id],
                    |r| r.get(0),
                )
                .optional()?;
            conn.execute("DELETE FROM tracks WHERE track_id = ?1", params![track_id])?;
            name
        };
        if let Some(name) = file_name {
            let _ = std::fs::remove_file(self.audio_dir.join(name));
        }
        let _ = std::fs::remove_file(self.art_path(track_id));
        Ok(())
    }

    pub fn set_artist_id(&self, track_id: u64, artist_id: u64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE tracks SET artist_id = ?2 WHERE track_id = ?1",
            params![track_id, artist_id],
        )?;
        Ok(())
    }

    /// Downloads made before artist_id / local-art existed: their rows still
    /// need a one-time backfill so the artist links work and OS Now-Playing art
    /// is available offline.
    pub fn ids_needing_backfill(&self) -> Result<Vec<u64>> {
        Ok(self
            .list()?
            .into_iter()
            .filter(|r| r.artist_id.is_none() || r.art_path.is_none())
            .map(|r| r.track_id)
            .collect())
    }

    pub fn set_pinned(&self, track_id: u64, pinned: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE tracks SET pinned = ?2 WHERE track_id = ?1",
            params![track_id, pinned as i64],
        )?;
        Ok(())
    }

    pub fn touch_played(&self, track_id: u64) {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute(
            "UPDATE tracks SET last_played_at = ?2 WHERE track_id = ?1",
            params![track_id, now_secs()],
        );
    }

    pub fn get_cap(&self) -> u64 {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT value FROM settings WHERE key = 'byte_cap'",
            [],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_CAP_BYTES)
    }

    pub fn set_cap(&self, cap: u64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('byte_cap', ?1)",
            params![cap.to_string()],
        )?;
        Ok(())
    }

    pub fn stats(&self) -> Result<CacheStats> {
        let (bytes_used, count) = {
            let conn = self.conn.lock().unwrap();
            conn.query_row(
                "SELECT COALESCE(SUM(bytes), 0), COUNT(*) FROM tracks",
                [],
                |r| Ok((r.get::<_, i64>(0)? as u64, r.get::<_, i64>(1)? as u64)),
            )?
        };
        Ok(CacheStats {
            bytes_used,
            byte_cap: self.get_cap(),
            count,
        })
    }

    /// Evict least-recently-played unpinned tracks until under the cap.
    pub fn evict_to_cap(&self) -> Result<Vec<u64>> {
        let cap = self.get_cap();
        let mut evicted = Vec::new();
        loop {
            let stats = self.stats()?;
            if stats.bytes_used <= cap {
                break;
            }
            let victim: Option<u64> = {
                let conn = self.conn.lock().unwrap();
                conn.query_row(
                    "SELECT track_id FROM tracks WHERE pinned = 0
                     ORDER BY last_played_at ASC, downloaded_at ASC LIMIT 1",
                    [],
                    |r| r.get(0),
                )
                .optional()?
            };
            match victim {
                Some(id) => {
                    self.remove(id)?;
                    evicted.push(id);
                }
                None => break, // everything pinned
            }
        }
        Ok(evicted)
    }
}
