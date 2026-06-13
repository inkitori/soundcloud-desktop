//! Write ops routed through a hidden soundcloud.com webview.
//!
//! DataDome scores api-v2 writes against the whole client — TLS/HTTP2
//! fingerprint plus its sensor cookies — so a clearance cookie replayed
//! through reqwest still gets challenged even when freshly captured from
//! the login webview. A fetch() from a page on https://soundcloud.com is
//! indistinguishable from the real web app, so writes pass; and when
//! DataDome challenges anyway, the captcha is shown right in the window
//! and solving it mints a real clearance in the shared cookie store
//! before the write is retried.
//!
//! Remote pages have no Tauri IPC, so results travel through a `scw`
//! cookie the page sets and `cookies_for_url` reads (the same channel the
//! login poller uses). A per-request sequence number guards against stale
//! reads, and a lane mutex keeps the channel single-writer.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use percent_encoding::percent_decode_str;
use reqwest::Method;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::error::AppError;

pub const WRITE_WINDOW: &str = "sc-write";
const HOME: &str = "https://soundcloud.com/";
const READY_TIMEOUT: Duration = Duration::from_secs(25);
const FETCH_TIMEOUT: Duration = Duration::from_secs(25);
const SOLVE_TIMEOUT: Duration = Duration::from_secs(180);
const POLL: Duration = Duration::from_millis(150);

static SEQ: AtomicU64 = AtomicU64::new(1);
static LANE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub enum WebWriteError {
    /// The webview machinery itself failed; the caller can fall back to a
    /// direct HTTP request.
    Unavailable(String),
    /// SoundCloud answered; this is the mapped API error.
    Api(AppError),
}

type WResult<T> = std::result::Result<T, WebWriteError>;

/// Perform one write. Returns the `id` field of the response when `want_id`
/// (playlist creation), `None` otherwise.
pub async fn run(
    app: &AppHandle,
    token: &Option<String>,
    client_id: &str,
    method: &Method,
    path: &str,
    body: Option<&Value>,
    want_id: bool,
) -> WResult<Option<u64>> {
    let _lane = LANE.lock().await;
    let window = ensure_window(app)?;
    wait_ready(&window).await?;

    let (status, payload) = do_fetch(&window, token, client_id, method, path, body, want_id).await?;
    if !is_challenge(status, &payload) {
        return map(status, payload, want_id);
    }

    // DataDome encodes its decision in the challenge URL: t=fe is a solvable
    // check, t=bv is a hard "blocked visitor" page no one can solve — showing
    // it would just dead-end, so explain and bail instead.
    let challenge_url = challenge_url(&payload).ok_or(WebWriteError::Api(AppError::BotChallenge))?;
    if challenge_url.contains("t=bv") {
        tracing::warn!("DataDome hard block (t=bv): {challenge_url}");
        return Err(WebWriteError::Api(AppError::Other(
            "SoundCloud's bot protection has temporarily blocked this device or network — \
             wait a while and try again"
                .into(),
        )));
    }

    // Challenged: surface the captcha, let the user solve it, retry once.
    if let Err(e) = solve_challenge(&window, &challenge_url).await {
        let _ = window.hide();
        return Err(e);
    }
    let result = do_fetch(&window, token, client_id, method, path, body, want_id).await;
    let _ = window.hide();
    let (status, payload) = result?;
    if is_challenge(status, &payload) {
        return Err(WebWriteError::Api(AppError::BotChallenge));
    }
    map(status, payload, want_id)
}

fn ensure_window(app: &AppHandle) -> WResult<WebviewWindow> {
    if let Some(w) = app.get_webview_window(WRITE_WINDOW) {
        return Ok(w);
    }
    let url: Url = HOME.parse().expect("static url");
    // Incognito: a fresh cookie jar per app session, so writes present a
    // clean DataDome identity instead of the shared webview session's cookie
    // (which accumulates flags and earns t=bv hard blocks). Auth comes from
    // the Authorization header, so the logged-out jar costs nothing.
    WebviewWindowBuilder::new(app, WRITE_WINDOW, WebviewUrl::External(url))
        .title("Verification — SoundCloud")
        .inner_size(480.0, 640.0)
        .visible(false)
        .incognito(true)
        .build()
        .map_err(|e| WebWriteError::Unavailable(format!("write webview: {e}")))
}

fn eval(window: &WebviewWindow, js: &str) -> WResult<()> {
    window
        .eval(js)
        .map_err(|e| WebWriteError::Unavailable(format!("eval: {e}")))
}

/// Read this request's message from the `scw` cookie, if present.
fn read_channel(window: &WebviewWindow, seq: u64) -> Option<String> {
    let url: Url = HOME.parse().ok()?;
    let cookies = window.cookies_for_url(url).ok()?;
    let value = cookies
        .iter()
        .find(|c| c.name() == "scw")
        .map(|c| c.value().to_string())?;
    value.strip_prefix(&format!("{seq}:")).map(str::to_owned)
}

/// Wait until the window has a usable soundcloud.com page (navigating it
/// back home first if a previous captcha left it elsewhere).
async fn wait_ready(window: &WebviewWindow) -> WResult<()> {
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let js = format!(
        r#"try{{if(document.readyState!=='loading'){{if(/(^|\.)soundcloud\.com$/.test(location.host)){{document.cookie='scw={seq}:ready;path=/';}}else{{location.href='{HOME}';}}}}}}catch(_e){{}}"#
    );
    let deadline = Instant::now() + READY_TIMEOUT;
    loop {
        eval(window, &js)?;
        tokio::time::sleep(POLL).await;
        if read_channel(window, seq).as_deref() == Some("ready") {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(WebWriteError::Unavailable(
                "write webview never became ready".into(),
            ));
        }
    }
}

/// Run the api-v2 request as a fetch() inside the page and collect
/// `(status, payload)`. `payload` is the response body (truncated) — or
/// just the response's `id` when `want_id` and the request succeeded.
async fn do_fetch(
    window: &WebviewWindow,
    token: &Option<String>,
    client_id: &str,
    method: &Method,
    path: &str,
    body: Option<&Value>,
    want_id: bool,
) -> WResult<(u16, String)> {
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let url = format!("https://api-v2.soundcloud.com{path}?client_id={client_id}");
    let url_js = serde_json::to_string(&url).expect("string to json");

    let mut headers = serde_json::Map::new();
    if let Some(t) = token {
        headers.insert("Authorization".into(), json!(format!("OAuth {t}")));
    }
    let mut init = json!({
        "method": method.as_str(),
        "credentials": "include",
        "headers": headers,
    });
    if let Some(b) = body {
        init["headers"]["Content-Type"] = json!("application/json");
        init["body"] = json!(b.to_string());
    }

    let extract = if want_id {
        "if(r.ok){try{t=String((JSON.parse(t)||{}).id||'')}catch(_e){}}"
    } else {
        ""
    };
    let js = format!(
        r#"fetch({url_js},{init}).then(async function(r){{
            var t='';try{{t=await r.text();}}catch(_e){{}}
            {extract}
            document.cookie='scw={seq}:'+r.status+':'+encodeURIComponent(t.slice(0,800))+';path=/';
        }}).catch(function(e){{
            document.cookie='scw={seq}:ERR:'+encodeURIComponent(String(e&&e.message||e).slice(0,200))+';path=/';
        }});"#
    );
    eval(window, &js)?;

    let deadline = Instant::now() + FETCH_TIMEOUT;
    loop {
        tokio::time::sleep(POLL).await;
        if let Some(rest) = read_channel(window, seq) {
            let _ = window.eval("document.cookie='scw=;Max-Age=0;path=/';");
            if let Some(msg) = rest.strip_prefix("ERR:") {
                return Err(WebWriteError::Unavailable(format!("page fetch: {msg}")));
            }
            let (status, encoded) = rest.split_once(':').unwrap_or((rest.as_str(), ""));
            let status: u16 = status
                .parse()
                .map_err(|_| WebWriteError::Unavailable(format!("bad result: {rest}")))?;
            let payload = percent_decode_str(encoded)
                .decode_utf8()
                .map(|s| s.into_owned())
                .unwrap_or_default();
            return Ok((status, payload));
        }
        if Instant::now() >= deadline {
            return Err(WebWriteError::Unavailable("write fetch timed out".into()));
        }
    }
}

fn is_challenge(status: u16, payload: &str) -> bool {
    (status == 401 || status == 403)
        && (payload.contains("captcha-delivery") || payload.contains("datadome"))
}

/// The challenge URL from a DataDome 403 body (`{"url": "https://geo.captcha-delivery.com/…"}`).
fn challenge_url(payload: &str) -> Option<String> {
    serde_json::from_str::<Value>(payload)
        .ok()
        .and_then(|v| v.get("url").and_then(Value::as_str).map(str::to_owned))
}

/// Show the DataDome captcha in the window and wait for the user to solve
/// it (the page redirects back to soundcloud.com on success).
async fn solve_challenge(window: &WebviewWindow, url: &str) -> WResult<()> {
    let url_js = serde_json::to_string(url).expect("string to json");
    eval(window, &format!("location.href={url_js}"))?;
    let _ = window.show();
    let _ = window.set_focus();

    let deadline = Instant::now() + SOLVE_TIMEOUT;
    loop {
        tokio::time::sleep(Duration::from_millis(750)).await;
        let Ok(current) = window.url() else {
            // Window closed by the user — give up on this attempt.
            return Err(WebWriteError::Api(AppError::BotChallenge));
        };
        let back_home = current
            .host_str()
            .is_some_and(|h| h == "soundcloud.com" || h.ends_with(".soundcloud.com"));
        if back_home {
            return wait_ready(window).await;
        }
        if Instant::now() >= deadline {
            return Err(WebWriteError::Api(AppError::BotChallenge));
        }
    }
}

fn map(status: u16, payload: String, want_id: bool) -> WResult<Option<u64>> {
    match status {
        s if (200..300).contains(&s) => {
            if !want_id {
                return Ok(None);
            }
            payload.trim().parse::<u64>().map(Some).map_err(|_| {
                WebWriteError::Api(AppError::Other(
                    "created, but SoundCloud's response had no id".into(),
                ))
            })
        }
        401 => Err(WebWriteError::Api(AppError::TokenExpired)),
        403 => Err(WebWriteError::Api(AppError::Other(
            "SoundCloud rejected this request (HTTP 403)".into(),
        ))),
        404 => Err(WebWriteError::Api(AppError::NotFound)),
        429 => Err(WebWriteError::Api(AppError::RateLimited {
            retry_after_secs: 30,
        })),
        s => Err(WebWriteError::Api(AppError::Other(format!("HTTP {s}")))),
    }
}
