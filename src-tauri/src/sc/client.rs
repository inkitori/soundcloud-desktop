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
}

impl ScClient {
    pub fn new(app: AppHandle) -> Arc<Self> {
        let http = reqwest::Client::builder()
            .user_agent(UA)
            .gzip(true)
            .timeout(Duration::from_secs(30))
            .build()
            .expect("failed to build http client");

        let persisted_cid = app
            .store(STORE_FILE)
            .ok()
            .and_then(|s| s.get("client_id"))
            .and_then(|v| v.as_str().map(str::to_owned));

        Arc::new(Self {
            http,
            app,
            client_id: RwLock::new(persisted_cid),
            token: RwLock::new(auth::get_token()),
            me_id: RwLock::new(None),
            last_request: Mutex::new(None),
        })
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
            if let Some(b) = &body {
                req = req.json(b);
            }

            let resp = req.send().await?;
            let status = resp.status();
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
                    if !refreshed_cid {
                        refreshed_cid = true;
                        tracing::info!("{status} from {full}; refreshing client_id");
                        self.refresh_client_id().await?;
                        continue;
                    }
                    if token.is_some() {
                        let _ = self.app.emit("auth:expired", ());
                        return Err(AppError::TokenExpired);
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
