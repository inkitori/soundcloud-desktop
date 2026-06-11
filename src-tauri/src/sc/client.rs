use std::sync::Arc;
use std::time::{Duration, Instant};

use reqwest::{Method, StatusCode};
use serde::de::DeserializeOwned;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;
use tokio::sync::{Mutex, RwLock};

use super::{auth, client_id};
use crate::error::{AppError, Result};

pub const API_BASE: &str = "https://api-v2.soundcloud.com";
/// Global minimum gap between api-v2 requests (~75 req/min ceiling).
const MIN_GAP: Duration = Duration::from_millis(800);
const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const STORE_FILE: &str = "settings.json";

pub struct ScClient {
    pub http: reqwest::Client,
    app: AppHandle,
    client_id: RwLock<Option<String>>,
    token: RwLock<Option<String>>,
    me_id: RwLock<Option<u64>>,
    last_request: Mutex<Option<Instant>>,
    /// DataDome clearance cookie copied from the browser. SoundCloud's bot
    /// protection challenges write requests (likes, playlist edits) that lack
    /// it; reads mostly pass without. Rotated from Set-Cookie on success.
    datadome: RwLock<Option<String>>,
}

impl ScClient {
    pub fn new(app: AppHandle) -> Arc<Self> {
        let http = reqwest::Client::builder()
            .user_agent(UA)
            .gzip(true)
            .timeout(Duration::from_secs(30))
            .build()
            .expect("failed to build http client");

        let store = app.store(STORE_FILE).ok();
        let read_str = |key: &str| {
            store
                .as_ref()
                .and_then(|s| s.get(key))
                .and_then(|v| v.as_str().map(str::to_owned))
        };
        let persisted_cid = read_str("client_id");
        let persisted_datadome = read_str("datadome");

        Arc::new(Self {
            http,
            app,
            client_id: RwLock::new(persisted_cid),
            token: RwLock::new(auth::get_token()),
            me_id: RwLock::new(None),
            last_request: Mutex::new(None),
            datadome: RwLock::new(persisted_datadome),
        })
    }

    pub async fn has_datadome(&self) -> bool {
        self.datadome.read().await.is_some()
    }

    /// Store a datadome cookie pasted by the user (accepts the raw value or a
    /// `datadome=…` / full cookie string; keeps just the value). Empty clears.
    pub async fn set_datadome(&self, cookie: Option<String>) {
        let value = cookie.and_then(|c| Self::extract_datadome(&c));
        if let Ok(store) = self.app.store(STORE_FILE) {
            match &value {
                Some(v) => store.set("datadome", serde_json::json!(v)),
                None => {
                    store.delete("datadome");
                }
            }
        }
        *self.datadome.write().await = value;
    }

    /// Pull the `datadome` value out of a raw value, a `datadome=…` pair, or a
    /// full `Cookie:`/`Set-Cookie:` string. Returns None for blank input.
    fn extract_datadome(raw: &str) -> Option<String> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return None;
        }
        let value = trimmed
            .split(';')
            .find_map(|part| part.trim().strip_prefix("datadome="))
            .unwrap_or(trimmed)
            .trim()
            .trim_matches('"');
        if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    }

    /// Persist a rotated datadome cookie seen on a successful response.
    async fn rotate_datadome(&self, value: String) {
        {
            let mut guard = self.datadome.write().await;
            if guard.as_deref() == Some(value.as_str()) {
                return;
            }
            *guard = Some(value.clone());
        }
        if let Ok(store) = self.app.store(STORE_FILE) {
            store.set("datadome", serde_json::json!(value));
        }
    }

    pub async fn has_token(&self) -> bool {
        self.token.read().await.is_some()
    }

    pub async fn token(&self) -> Option<String> {
        self.token.read().await.clone()
    }

    pub async fn set_token(&self, token: Option<String>) {
        *self.token.write().await = token;
        *self.me_id.write().await = None;
    }

    pub async fn me_id(&self) -> Result<u64> {
        if let Some(id) = *self.me_id.read().await {
            return Ok(id);
        }
        if !self.has_token().await {
            return Err(AppError::NotLoggedIn);
        }
        let me: super::models::User = self.get_json("/me", &[]).await?;
        *self.me_id.write().await = Some(me.id);
        Ok(me.id)
    }

    pub async fn set_me(&self, id: u64) {
        *self.me_id.write().await = Some(id);
    }

    async fn rate_limit(&self) {
        let mut last = self.last_request.lock().await;
        if let Some(prev) = *last {
            let elapsed = prev.elapsed();
            if elapsed < MIN_GAP {
                tokio::time::sleep(MIN_GAP - elapsed).await;
            }
        }
        *last = Some(Instant::now());
    }

    async fn ensure_client_id(&self) -> Result<String> {
        if let Some(id) = self.client_id.read().await.clone() {
            return Ok(id);
        }
        self.refresh_client_id().await
    }

    pub async fn refresh_client_id(&self) -> Result<String> {
        let id = client_id::scrape(&self.http).await?;
        *self.client_id.write().await = Some(id.clone());
        if let Ok(store) = self.app.store(STORE_FILE) {
            store.set("client_id", serde_json::json!(id.clone()));
        }
        Ok(id)
    }

    /// Core api-v2 request with client_id refresh on 401/403 and 429 backoff.
    pub async fn request_value(
        &self,
        method: Method,
        url: &str,
        query: &[(&str, String)],
        body: Option<Value>,
    ) -> Result<Value> {
        self.request_value_inner(method, url, query, body, true).await
    }

    /// Same as `request_value` but skips the global rate limiter. Used on the
    /// playback-critical path (transcoding resolve) where the ~800ms gap would
    /// add audible latency to every click; these are single user-initiated
    /// calls, not scrape loops.
    pub async fn request_value_fast(
        &self,
        method: Method,
        url: &str,
        query: &[(&str, String)],
        body: Option<Value>,
    ) -> Result<Value> {
        self.request_value_inner(method, url, query, body, false).await
    }

    async fn request_value_inner(
        &self,
        method: Method,
        url: &str,
        query: &[(&str, String)],
        body: Option<Value>,
        rate_limited: bool,
    ) -> Result<Value> {
        let full = if url.starts_with("http") {
            url.to_string()
        } else {
            format!("{API_BASE}{url}")
        };

        let mut refreshed_cid = false;
        let mut backoff_429 = [1u64, 3].into_iter();

        loop {
            if rate_limited {
                self.rate_limit().await;
            }
            let cid = self.ensure_client_id().await?;

            let mut req = self.http.request(method.clone(), &full);
            // next_href URLs may already carry client_id; don't duplicate.
            if !full.contains("client_id=") {
                req = req.query(&[("client_id", cid.as_str())]);
            }
            for (k, v) in query {
                req = req.query(&[(*k, v.as_str())]);
            }
            let token = self.token().await;
            if let Some(t) = &token {
                req = req.header("Authorization", format!("OAuth {t}"));
            }
            if let Some(dd) = self.datadome.read().await.clone() {
                req = req.header("Cookie", format!("datadome={dd}"));
            }
            if let Some(b) = &body {
                req = req.json(b);
            }

            let resp = req.send().await?;
            let status = resp.status();
            if let Some(dd) = extract_set_datadome(resp.headers()) {
                // Only trust rotations from non-challenge responses, so the
                // captcha 403's throwaway cookie never clobbers a good one.
                if status.is_success() {
                    self.rotate_datadome(dd).await;
                }
            }
            match status {
                s if s.is_success() => {
                    let text = resp.text().await?;
                    if text.trim().is_empty() {
                        return Ok(Value::Null);
                    }
                    return serde_json::from_str(&text)
                        .map_err(|e| AppError::Other(format!("invalid json from {full}: {e}")));
                }
                StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                    // DataDome serves a captcha page (HTTP 403) on write requests
                    // that lack a valid clearance cookie. Detect it before the
                    // client_id / token-expiry logic so we surface the real cause.
                    let body = resp.text().await.unwrap_or_default();
                    if body.contains("captcha-delivery.com") || body.contains("datadome") {
                        return Err(AppError::BotChallenge);
                    }
                    if !refreshed_cid {
                        refreshed_cid = true;
                        tracing::info!("{status} from {full}; refreshing client_id");
                        self.refresh_client_id().await?;
                        continue;
                    }
                    if token.is_some() {
                        // Writes can 401/403 for non-auth reasons (bot
                        // protection, endpoint shape drift); only declare the
                        // token dead if /me agrees it's rejected.
                        if self.probe_token_rejected().await {
                            let _ = self.app.emit("auth:expired", ());
                            return Err(AppError::TokenExpired);
                        }
                        return Err(AppError::Other(format!(
                            "SoundCloud rejected this request ({status})"
                        )));
                    }
                    return Err(AppError::Other(format!("blocked ({status})")));
                }
                StatusCode::TOO_MANY_REQUESTS => {
                    let retry_after = resp
                        .headers()
                        .get("retry-after")
                        .and_then(|h| h.to_str().ok())
                        .and_then(|s| s.parse::<u64>().ok());
                    if let Some(b) = backoff_429.next() {
                        let wait = retry_after.unwrap_or(b).min(15);
                        tracing::warn!("429 from {full}; waiting {wait}s");
                        tokio::time::sleep(Duration::from_secs(wait)).await;
                        continue;
                    }
                    return Err(AppError::RateLimited {
                        retry_after_secs: retry_after.unwrap_or(30),
                    });
                }
                StatusCode::NOT_FOUND => return Err(AppError::NotFound),
                s => return Err(AppError::Other(format!("HTTP {s} for {full}"))),
            }
        }
    }

    /// True only when /me itself answers 401/403 for the current token. Hits
    /// the API directly (not `request_value_inner`) to avoid recursing.
    async fn probe_token_rejected(&self) -> bool {
        let Some(token) = self.token().await else {
            return false;
        };
        let Some(cid) = self.client_id.read().await.clone() else {
            return false;
        };
        let resp = self
            .http
            .get(format!("{API_BASE}/me"))
            .query(&[("client_id", cid.as_str())])
            .header("Authorization", format!("OAuth {token}"))
            .send()
            .await;
        matches!(
            resp.map(|r| r.status()),
            Ok(StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN)
        )
    }

    pub async fn get_value(&self, url: &str, query: &[(&str, String)]) -> Result<Value> {
        self.request_value(Method::GET, url, query, None).await
    }

    /// GET without the global rate limiter (playback-critical path).
    pub async fn get_value_fast(&self, url: &str, query: &[(&str, String)]) -> Result<Value> {
        self.request_value_fast(Method::GET, url, query, None).await
    }

    pub async fn get_json<T: DeserializeOwned>(
        &self,
        url: &str,
        query: &[(&str, String)],
    ) -> Result<T> {
        let v = self.get_value(url, query).await?;
        serde_path_to_error::deserialize(v)
            .map_err(|e| AppError::Other(format!("decode error at `{}`: {e}", e.path())))
    }

    /// Plain fetch (no client_id, no rate limiter) for CDN resources:
    /// waveform JSON, m3u8 playlists, media segments.
    pub async fn fetch_text(&self, url: &str) -> Result<String> {
        let resp = self.http.get(url).send().await?;
        if !resp.status().is_success() {
            return Err(AppError::Other(format!("HTTP {} for {url}", resp.status())));
        }
        Ok(resp.text().await?)
    }

    pub async fn fetch_json_value(&self, url: &str) -> Result<Value> {
        let text = self.fetch_text(url).await?;
        serde_json::from_str(&text).map_err(|e| AppError::Other(format!("invalid json: {e}")))
    }
}

/// Pull a rotated `datadome` cookie value out of a response's Set-Cookie headers.
fn extract_set_datadome(headers: &reqwest::header::HeaderMap) -> Option<String> {
    for value in headers.get_all(reqwest::header::SET_COOKIE) {
        let Ok(text) = value.to_str() else { continue };
        for part in text.split(';') {
            if let Some(v) = part.trim().strip_prefix("datadome=") {
                let v = v.trim();
                if !v.is_empty() {
                    return Some(v.to_string());
                }
            }
        }
    }
    None
}
