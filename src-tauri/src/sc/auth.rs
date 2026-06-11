use crate::error::{AppError, Result};
use keyring::Entry;

const SERVICE: &str = "com.enyouki.soundcloud";
const ACCOUNT: &str = "oauth_token";

fn entry() -> Result<Entry> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| AppError::Other(format!("keychain: {e}")))
}

pub fn get_token() -> Option<String> {
    let token = entry().ok()?.get_password().ok()?;
    let token = token.trim().to_string();
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

pub fn set_token(token: &str) -> Result<()> {
    entry()?
        .set_password(token.trim())
        .map_err(|e| AppError::Other(format!("keychain: {e}")))
}

pub fn clear_token() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Other(format!("keychain: {e}"))),
    }
}
