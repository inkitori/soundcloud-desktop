use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize)]
pub struct Page<T> {
    pub collection: Vec<T>,
    pub next_href: Option<String>,
}

/// Parse each element individually so one malformed item never kills a page.
pub fn parse_items<T: DeserializeOwned>(items: &[Value]) -> Vec<T> {
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        match serde_path_to_error::deserialize::<_, T>(item.clone()) {
            Ok(v) => out.push(v),
            Err(e) => tracing::warn!("skipping malformed item at `{}`: {e}", e.path()),
        }
    }
    out
}

pub fn parse_page<T: DeserializeOwned>(v: Value) -> Page<T> {
    let next_href = v
        .get("next_href")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let collection = v
        .get("collection")
        .and_then(Value::as_array)
        .map(|a| parse_items::<T>(a))
        .unwrap_or_default();
    Page {
        collection,
        next_href,
    }
}
