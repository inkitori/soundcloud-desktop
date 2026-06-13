//! Embedded sign-in: opens a webview window on SoundCloud's sign-in page and
//! polls its cookie store for the session cookies. Replaces the manual
//! "copy oauth_token from DevTools" flow — and because the webview runs
//! DataDome's JS like a real browser, it also yields a valid `datadome`
//! clearance cookie, unblocking write requests.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder};

use super::client::ScClient;
use crate::error::{AppError, Result};

pub const LOGIN_WINDOW: &str = "sc-login";
const POLL_INTERVAL: Duration = Duration::from_millis(750);

/// Guards against a second poll task when the window is closed and reopened
/// within one poll tick (the surviving task simply picks up the new window).
static POLL_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Open (or focus) the sign-in window and start watching its cookies.
/// Returns immediately; progress is reported to the main window via events:
/// `login:success` (payload: the signed-in User) and `login:closed`.
pub fn start(app: AppHandle, sc: Arc<ScClient>) -> Result<()> {
    if let Some(existing) = app.get_webview_window(LOGIN_WINDOW) {
        let _ = existing.set_focus();
        return Ok(());
    }

    let url: Url = "https://soundcloud.com/signin".parse().expect("static url");
    let window = WebviewWindowBuilder::new(&app, LOGIN_WINDOW, WebviewUrl::External(url))
        .title("Sign in — SoundCloud")
        .inner_size(500.0, 760.0)
        .build()
        .map_err(|e| AppError::Other(format!("couldn't open the sign-in window: {e}")))?;
    let _ = window.set_focus();

    if POLL_ACTIVE
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
    {
        tauri::async_runtime::spawn(poll_for_token(app, sc));
    }
    Ok(())
}

pub fn cancel(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LOGIN_WINDOW) {
        let _ = window.close();
    }
}

/// Watch the sign-in window's cookie store until an `oauth_token` appears
/// (instant if the webview already has a SoundCloud session) or the window
/// is closed. Cookie reads must stay off the main thread.
async fn poll_for_token(app: AppHandle, sc: Arc<ScClient>) {
    let url: Url = "https://soundcloud.com/".parse().expect("static url");
    loop {
        tokio::time::sleep(POLL_INTERVAL).await;
        let Some(window) = app.get_webview_window(LOGIN_WINDOW) else {
            POLL_ACTIVE.store(false, Ordering::SeqCst);
            let _ = app.emit("login:closed", ());
            return;
        };

        let cookies = match window.cookies_for_url(url.clone()) {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!("login cookie poll failed: {e}");
                continue;
            }
        };
        let find = |name: &str| {
            cookies
                .iter()
                .find(|c| c.name() == name)
                .map(|c| c.value().trim().to_string())
                .filter(|v| !v.is_empty())
        };

        let Some(token) = find("oauth_token") else {
            continue;
        };
        if let Some(dd) = find("datadome") {
            sc.set_datadome(Some(dd)).await;
        }

        let prev = sc.token().await;
        sc.set_token(Some(token)).await;
        match sc.ep_me().await {
            Ok(me) => {
                sc.set_me(me.id).await;
                POLL_ACTIVE.store(false, Ordering::SeqCst);
                let _ = window.close();
                let _ = app.emit("login:success", &me);
                return;
            }
            Err(e) => {
                // Cookie present but not (yet) accepted — likely mid-redirect.
                // Restore the previous token and keep waiting.
                tracing::debug!("token probe failed, still waiting: {e}");
                sc.set_token(prev).await;
            }
        }
    }
}
