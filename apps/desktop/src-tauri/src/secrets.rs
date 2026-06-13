//! Per-install secrets the sidecar needs but the desktop build can't ship.
//!
//! The hosted deploy injects `ENCRYPTION_KEY` (repo-config / env-var encryption
//! at rest) and `TERMINAL_AUTH_SECRET` (terminal auth tokens) as deployment
//! secrets. A desktop
//! install is a single machine with no deployment, so the shell mints them on
//! first launch and persists them next to the app data — stable across restarts
//! (so data encrypted on one run decrypts on the next) and unique per install.

use std::error::Error;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct Secrets {
    /// 32-byte key, hex-encoded — `lib/crypto` reads it as `Buffer.from(_, "hex")`.
    pub encryption_key: String,
    pub terminal_auth_secret: String,
}

/// Load the persisted secrets, generating and writing them on first launch.
pub fn load_or_create(data_dir: &Path) -> Result<Secrets, Box<dyn Error>> {
    let path = data_dir.join("secrets.json");

    if let Ok(text) = fs::read_to_string(&path) {
        if let Ok(secrets) = serde_json::from_str::<Secrets>(&text) {
            return Ok(secrets);
        }
        // A corrupt file would otherwise wedge every launch; fall through and
        // rewrite. (Re-keying orphans data encrypted under the old key, but a
        // corrupt secrets file means that data is unreadable regardless.)
    }

    let secrets = Secrets {
        encryption_key: random_hex(32),
        terminal_auth_secret: random_hex(32),
    };
    fs::create_dir_all(data_dir)?;
    fs::write(&path, serde_json::to_string_pretty(&secrets)?)?;
    restrict(&path);
    Ok(secrets)
}

/// Tighten the secrets file to owner-only (best effort, unix).
fn restrict(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
}

/// `bytes` of CSPRNG output, lowercase hex.
fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::getrandom(&mut buf).expect("OS CSPRNG unavailable");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}
