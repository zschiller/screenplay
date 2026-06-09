//! The Node sidecar: extract the bundled tree, spawn it, probe it, reap it.

use std::error::Error;
use std::fs::{self, File};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::time::Duration;

use flate2::read::GzDecoder;
use tar::Archive;
use tauri::{AppHandle, Manager};

use crate::thumbnail::ControlServer;

/// A running sidecar plus the side servers tied to its lifetime.
pub struct Sidecar {
    pub port: u16,
    child: Child,
    control: ControlServer,
}

impl Sidecar {
    /// Kill + reap the Node child and stop the control server. Idempotent enough
    /// for the single ExitRequested call that drives it.
    pub fn shutdown(&mut self) {
        self.control.stop();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Extract the bundled sidecar, pick a port, start the control server, and spawn
/// `node server.js` wired to the desktop backend profile.
pub fn launch(app: &AppHandle) -> Result<Sidecar, Box<dyn Error>> {
    let dir = extract(app)?;
    let port = free_port()?;
    let control = ControlServer::start(app.clone())?;
    let child = spawn(app, &dir, port, &control.url())?;
    Ok(Sidecar {
        port,
        child,
        control,
    })
}

/// An OS-assigned free localhost port. The listener is dropped immediately and
/// the port handed to the sidecar; the tiny TOCTOU window is covered by the
/// health loop (spike #407).
fn free_port() -> Result<u16, Box<dyn Error>> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    Ok(listener.local_addr()?.port())
}

/// Extract `resources/sidecar.tar.gz` into a version-stamped cache dir, once.
/// Re-unpacked when the stamped dir name changes (a release version bump) or
/// when the bundled tarball's content changes (a `build:sidecar` rebuild during
/// dev — the version stays constant, so without this the new tarball would be
/// silently ignored and a stale sidecar served). Unpacking restores the pnpm
/// symlinks Tauri's resource copy drops — the reason the sidecar ships as a tar,
/// not a directory (spike #407).
fn extract(app: &AppHandle) -> Result<PathBuf, Box<dyn Error>> {
    let version = app.package_info().version.to_string();
    let dest = app.path().app_cache_dir()?.join(format!("sidecar-{version}"));
    let server_js = dest.join("apps").join("app").join("server.js");
    let stamp_path = dest.join(".tarball-stamp");

    let archive = app
        .path()
        .resource_dir()?
        .join("resources")
        .join("sidecar.tar.gz");

    // Cheap content fingerprint: the tarball's byte length + mtime. A rebuild
    // changes both, so we avoid hashing the (large) archive on every launch.
    let want_stamp = tarball_stamp(&archive);
    let have_stamp = fs::read_to_string(&stamp_path).ok();
    let fresh = server_js.exists() && have_stamp.as_deref() == want_stamp.as_deref();

    if !fresh {
        // Wipe any prior (partial or stale) extract so we never mix trees.
        if dest.exists() {
            fs::remove_dir_all(&dest)?;
        }
        fs::create_dir_all(&dest)?;
        let file = File::open(&archive)
            .map_err(|e| format!("opening bundled sidecar {archive:?}: {e}"))?;
        let mut tar = Archive::new(GzDecoder::new(file));
        tar.set_preserve_permissions(true);
        tar.unpack(&dest)?;
        if let Some(stamp) = want_stamp {
            let _ = fs::write(&stamp_path, stamp);
        }
    }

    ensure_executable(&dest.join("node"));
    Ok(dest)
}

/// `len:mtime` fingerprint of the bundled tarball, or `None` if it can't be
/// stat'd (in which case we fall back to the server.js-exists check alone).
fn tarball_stamp(archive: &std::path::Path) -> Option<String> {
    let meta = fs::metadata(archive).ok()?;
    let mtime = meta
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_nanos();
    Some(format!("{}:{}", meta.len(), mtime))
}

/// Defensive `chmod +x` on the bundled `node` — its bit survived on macOS in the
/// spike but isn't guaranteed across packagers/tar implementations.
fn ensure_executable(path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::metadata(path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = fs::set_permissions(path, perms);
        }
    }
}

/// Spawn `node apps/app/server.js` with the desktop backend profile. The seam
/// selectors mirror `apps/desktop/desktop.env`; the machine-specific paths and
/// the control URL are computed here (they can't live in a committed file).
fn spawn(
    app: &AppHandle,
    dir: &std::path::Path,
    port: u16,
    control_url: &str,
) -> Result<Child, Box<dyn Error>> {
    let data = app.path().app_data_dir()?;
    let app_root = dir.join("apps").join("app");

    let pglite = data.join("pglite");
    let yjs = data.join("yjs");
    let blobs = data.join("blobs");
    for d in [&pglite, &yjs, &blobs] {
        fs::create_dir_all(d).ok();
    }

    // Per-install secrets (minted + persisted on first launch) the sidecar would
    // otherwise get from deployment config.
    let secrets = crate::secrets::load_or_create(&data)?;

    let mut cmd = Command::new(dir.join("node"));
    cmd.arg(app_root.join("server.js"))
        .current_dir(&app_root)
        .env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        // The single desktop switch (matches desktop.env's runtime half).
        .env("NEXT_PUBLIC_SCREENPLAY_LOCAL", "1")
        .env("NEXT_PUBLIC_YJS_HOST", "local")
        .env("SANDBOX_BACKEND", "worktree")
        .env("SCREENPLAY_DB", "pglite")
        .env("BLOB_STORE", "local-fs")
        .env("AGENT_ENGINE", "external")
        .env("THUMBNAIL_CAPTURER", "tauri-webview")
        .env("SCREENPLAY_ACP_HARNESS", "claude")
        .env("TAURI_CONTROL_URL", control_url)
        // Our PID, so the sidecar can self-exit if this shell dies without a
        // clean quit (Ctrl-C / hot-reload / crash) instead of orphaning.
        .env("SCREENPLAY_SHELL_PID", std::process::id().to_string())
        // Machine-specific runtime paths under the OS app-data dir.
        .env("PGLITE_DATA_DIR", &pglite)
        .env("PGLITE_MIGRATIONS_DIR", app_root.join("drizzle").join("local"))
        .env("YJS_PERSISTENCE_DIR", &yjs)
        .env("LOCAL_BLOB_DIR", &blobs)
        .env("LOCAL_BLOB_BASE_URL", format!("http://127.0.0.1:{port}/blobs"))
        .env("BETTER_AUTH_URL", format!("http://127.0.0.1:{port}"))
        // Per-install secrets (see secrets.rs).
        .env("ENCRYPTION_KEY", &secrets.encryption_key)
        .env("THUMBNAIL_RENDER_SECRET", &secrets.thumbnail_render_secret)
        .env("TERMINAL_AUTH_SECRET", &secrets.terminal_auth_secret)
        // A packaged .app launches with a minimal PATH; the agent path shells
        // out to `npx` for the ACP adapter, so prepend the usual node install
        // locations (and the bundled node's own dir) to the inherited PATH.
        .env("PATH", augmented_path(dir));

    Ok(cmd.spawn()?)
}

/// Prepend common node-install bin dirs (+ the bundled node's dir) to PATH so a
/// GUI-launched app can still resolve `npx`/`node` for the ACP adapter spawn.
fn augmented_path(dir: &std::path::Path) -> String {
    let existing = std::env::var("PATH").unwrap_or_default();
    let prefixes = [
        dir.to_string_lossy().to_string(),
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
    ];
    format!("{}:{}", prefixes.join(":"), existing)
}

/// Poll `/api/health` until it 200s (or give up after ~30s). The first success
/// was ~316 ms after spawn in the spike; the cap covers a cold PGlite migrate.
pub fn wait_until_healthy(port: u16) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{port}/api/health");
    for _ in 0..300 {
        if let Ok(resp) = ureq::get(&url).timeout(Duration::from_secs(2)).call() {
            if resp.status() == 200 {
                return Ok(());
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err(format!("/api/health on {port} never returned 200"))
}
