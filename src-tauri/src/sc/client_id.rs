use crate::error::{AppError, Result};
use regex::Regex;

/// Scrape the public client_id from soundcloud.com's JS bundles.
/// yt-dlp's proven pattern: scan script bundles in reverse order.
pub async fn scrape(http: &reqwest::Client) -> Result<String> {
    let home = http
        .get("https://soundcloud.com/")
        .send()
        .await?
        .text()
        .await?;

    let script_re = Regex::new(r#"https://a-v2\.sndcdn\.com/assets/[^"]+\.js"#).unwrap();
    let cid_re = Regex::new(r#"client_id\s*:\s*"([0-9a-zA-Z]{32})""#).unwrap();

    let scripts: Vec<&str> = script_re.find_iter(&home).map(|m| m.as_str()).collect();
    for url in scripts.iter().rev() {
        let Ok(resp) = http.get(*url).send().await else {
            continue;
        };
        let Ok(body) = resp.text().await else { continue };
        if let Some(cap) = cid_re.captures(&body) {
            tracing::info!("scraped client_id from {url}");
            return Ok(cap[1].to_string());
        }
    }
    Err(AppError::ClientId)
}
