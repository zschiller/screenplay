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
    /// Stop the control server and bring the Node child down — gracefully
    /// first, then by force. Idempotent enough for the single ExitRequested
    /// call that drives it.
    ///
    /// The graceful step matters: the sidecar's dev servers are *detached*
    /// host process groups (setsid'd supervisor loops), so a straight SIGKILL
    /// of the sidecar orphans every one of them until the next launch sweeps
    /// their pidfiles. SIGTERM instead lets the sidecar's exit hook (the local
    /// sandbox reaper installed by instrumentation.ts) group-kill them before
    /// it exits. SIGKILL remains the fallback for a sidecar too wedged to
    /// handle the signal within the grace window.
    pub fn shutdown(&mut self) {
        self.control.stop();
        #[cfg(unix)]
        {
            let _ = Command::new("kill")
                .args(["-TERM", &self.child.id().to_string()])
                .status();
            // ~3s grace: the reaper's pidfile sweep is a handful of signals +
            // unlinks, so a healthy sidecar exits near-instantly.
            for _ in 0..30 {
                if matches!(self.child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Pick a port, start the control server, and spawn the Next server wired to
/// the desktop backend profile. Debug builds (`tauri dev`) run the repo's
/// `next dev` for live reload; release builds (and dev with
/// `SCREENPLAY_BUNDLED_SIDECAR=1`) extract and run the bundled standalone tree.
pub fn launch(app: &AppHandle) -> Result<Sidecar, Box<dyn Error>> {
    let port = free_port()?;
    let control = ControlServer::start(app.clone())?;
    let child = if use_dev_server() {
        spawn_dev(app, port, &control.url())?
    } else {
        let dir = extract(app)?;
        spawn(app, &dir, port, &control.url())?
    };
    Ok(Sidecar {
        port,
        child,
        control,
    })
}

/// Live `next dev` in debug builds, unless the developer opts back into the
/// packaged tarball to test the production path (`SCREENPLAY_BUNDLED_SIDECAR=1
/// pnpm --filter desktop dev` after a `build:sidecar`).
fn use_dev_server() -> bool {
    cfg!(debug_assertions) && std::env::var_os("SCREENPLAY_BUNDLED_SIDECAR").is_none()
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

/// Spawn `node apps/app/server.js` with the desktop backend profile.
fn spawn(
    app: &AppHandle,
    dir: &std::path::Path,
    port: u16,
    control_url: &str,
) -> Result<Child, Box<dyn Error>> {
    let app_root = dir.join("apps").join("app");

    let mut cmd = Command::new(dir.join("node"));
    cmd.arg(app_root.join("server.js"))
        .current_dir(&app_root)
        // A packaged .app launches with a minimal PATH; the agent path shells
        // out to `npx` for the ACP adapter, so prepend the usual node install
        // locations (and the bundled node's own dir) to the inherited PATH.
        .env("PATH", augmented_path(dir));
    apply_desktop_env(&mut cmd, app, port, control_url, &app_root)?;

    Ok(cmd.spawn()?)
}

/// Spawn the repo's `next dev --turbopack` (debug builds only): app changes
/// hot-reload instead of requiring a `build:sidecar` round-trip. Same desktop
/// profile as the packaged sidecar, plus the two vars `build-sidecar.mjs` bakes
/// in at build time — set as process env here so they beat any hosted-dev
/// `.env.local` (Next never overrides existing process env).
fn spawn_dev(app: &AppHandle, port: u16, control_url: &str) -> Result<Child, Box<dyn Error>> {
    // src-tauri/ → desktop/ → apps/ → repo root. Compile-time path is fine
    // here: dev builds only run on the machine that compiled them.
    let app_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("app");

    let mut cmd = Command::new(app_root.join("node_modules").join(".bin").join("next"));
    cmd.args(["dev", "--turbopack"])
        .current_dir(&app_root)
        .env("SCREENPLAY_DESKTOP", "1")
        .env("NEXT_PUBLIC_BASE_PATH", "");
    apply_desktop_env(&mut cmd, app, port, control_url, &app_root)?;

    Ok(cmd.spawn()?)
}

/// The desktop backend profile, shared by the packaged and dev spawns. The seam
/// selectors mirror `apps/desktop/desktop.env`; the machine-specific paths and
/// the control URL are computed here (they can't live in a committed file).
fn apply_desktop_env(
    cmd: &mut Command,
    app: &AppHandle,
    port: u16,
    control_url: &str,
    app_root: &std::path::Path,
) -> Result<(), Box<dyn Error>> {
    let data = app.path().app_data_dir()?;

    let pglite = data.join("pglite");
    let yjs = data.join("yjs");
    let blobs = data.join("blobs");
    for d in [&pglite, &yjs, &blobs] {
        fs::create_dir_all(d).ok();
    }

    // Per-install secrets (minted + persisted on first launch) the sidecar would
    // otherwise get from deployment config.
    let secrets = crate::secrets::load_or_create(&data)?;

    cmd.env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        // The single desktop switch (matches desktop.env's runtime half).
        .env("NEXT_PUBLIC_SCREENPLAY_LOCAL", "1")
        .env("NEXT_PUBLIC_YJS_HOST", "local")
        .env("SANDBOX_BACKEND", "local")
        .env("SCREENPLAY_DB", "pglite")
        .env("BLOB_STORE", "local-fs")
        .env("AGENT_ENGINE", "external")
        .env("THUMBNAIL_CAPTURER", "tauri-webview")
        // SCREENPLAY_ACP_HARNESS is deliberately left unset: the app already
        // defaults to "claude-code" (DEFAULT_ACP_HARNESS). Unlike the seam vars
        // above, the desktop value matched that default, so restating it here
        // only risked drift (it once read "claude", which matches no adapter and
        // broke chats with no stored model). Set it (e.g. "codex") only to back
        // chat with a different installed CLI.
        .env("TAURI_CONTROL_URL", control_url)
        // Our PID, so the sidecar can self-exit if this shell dies without a
        // clean quit (Ctrl-C / hot-reload / crash) instead of orphaning.
        .env("SCREENPLAY_SHELL_PID", std::process::id().to_string())
        // Machine-specific runtime paths under the OS app-data dir.
        .env("PGLITE_DATA_DIR", &pglite)
        .env("PGLITE_MIGRATIONS_DIR", app_root.join("drizzle").join("local"))
        .env("YJS_PERSISTENCE_DIR", &yjs)
        .env("LOCAL_BLOB_DIR", &blobs)
        // Origin-relative on purpose: blob URLs are persisted in room rows, and
        // the port is random per launch — an absolute URL would strand every
        // previously captured thumbnail on a dead origin after a restart. The
        // webview always loads from the sidecar's own origin, so a bare path
        // resolves correctly whatever this launch's port is.
        .env("LOCAL_BLOB_BASE_URL", "/blobs")
        .env("BETTER_AUTH_URL", format!("http://127.0.0.1:{port}"))
        // Per-install secrets (see secrets.rs).
        .env("ENCRYPTION_KEY", &secrets.encryption_key)
        .env("TERMINAL_AUTH_SECRET", &secrets.terminal_auth_secret);

    // The GitHub App client id for the optional "Connect GitHub" device flow
    // (PRD #428), baked in at compile time by the release pipeline —
    // `desktop.env` deliberately leaves it unset. When absent (or empty, as an
    // unset repo variable yields in CI) the connect affordance doesn't offer
    // itself; `gh` and the URL/local-folder no-auth floor still work.
    match option_env!("SCREENPLAY_GITHUB_CLIENT_ID") {
        Some(client_id) if !client_id.is_empty() => {
            cmd.env("SCREENPLAY_GITHUB_CLIENT_ID", client_id);
        }
        _ => {}
    }

    Ok(())
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
