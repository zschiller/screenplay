# 10. Local backend: portless delivers the dev port, not `$SCREENPLAY_PORT`

Date: 2026-06-10

Status: Accepted

## Context

The #433 port contract (reaffirmed by ADR 0009) resolves each Sandbox's Dev
Server Port through the `hostPort` seam and hands the resolved value to the
user's dev script as `$SCREENPLAY_PORT` (with `$PORT` set alongside). That
made every Repo's dev script responsible for forwarding a Screenplay-specific
variable — `next dev --port $SCREENPLAY_PORT` — and a script that didn't was
unsupported for multi-Branch desktop previews.

[portless](https://portless.sh) solves the same problem as a host-level tool:
it assigns a dev server its port (injecting the conventional `$PORT`, plus
`--port` flags for frameworks that ignore it), registers a stable named
`.localhost` route per app, and prefixes the route with the branch name when
run inside a git worktree — which is exactly what each desktop Sandbox is.

## Decision

- **On the local backend, the dev script runs under portless.**
  `launchDevAndProxy` wraps it as
  `node <portless>/dist/cli.js run --app-port <resolved> sh -c '<dev script>'`
  inside the existing restart-on-crash supervisor. The script rides a single
  `sh -c` argument so its full shell semantics survive; portless contributes
  the port (`$PORT` is in scope when the inner shell expands the script) and
  the named route (`<branch>.<package-name>.localhost`, visible via
  `portless list`). `$SCREENPLAY_PORT` is **not set** on this backend — the
  contract is portless's convention, not a Screenplay-specific variable.

- **`--app-port` pins portless to the allocated host port.** The per-Sandbox
  `PortAllocator` and the `hostPort` seam stay: the bridge proxy must know its
  upstream, the preview URL still points at the proxy's resolved port, and the
  allocation already guarantees cross-Sandbox distinctness. Portless owns
  *delivering* the port, not choosing it.

- **No `--force` on the route.** A route left behind by a group-killed
  previous launch has a dead pid and portless reclaims it silently; a *live*
  conflicting owner (an unrelated portless app with the same name) fails
  visibly in the sandbox log rather than being SIGTERMed.

- **portless ships with the app.** It is a regular dependency (zero runtime
  deps, ~450 KB), resolved at `<cwd>/node_modules/portless/dist/cli.js` and
  folded into the desktop sidecar tree by `build-sidecar.mjs` — no global
  install on the host. Its proxy daemon is the one host-level prerequisite:
  it cannot sudo without a TTY, so a desktop user runs
  `npx portless proxy start` (or `portless service install`) once;
  `DevServerPortIgnoredError` names that remedy.

- **The hosted backend is unchanged.** Its sandboxes are remote VMs where
  `.localhost` routes are meaningless; it keeps handing
  `$SCREENPLAY_PORT`/`$PORT` to the dev script. A dev script that honors
  `$PORT` is portable across both backends.

## Consequences

- Dev scripts no longer need a Screenplay-specific variable on desktop:
  `npm run dev` works as-is for `$PORT`-honoring frameworks (Next, CRA,
  Express, Nuxt); tools that ignore `$PORT` forward it explicitly
  (`vite --port $PORT --strictPort`). Existing configs that pass
  `--port $SCREENPLAY_PORT` break on desktop (the variable expands empty) and
  must drop the flag or switch to `$PORT` — accepted pre-release.
- `DevServerPortIgnoredError` now covers two causes — a script ignoring
  `$PORT` and portless failing to launch (proxy daemon down) — and points at
  the Logs panel, where portless's own output tells them apart.
- The preview iframe still loads the bridge proxy on its resolved port; the
  portless route points at the raw dev server (no DOM bridge) and exists for
  humans and agents, not for the canvas.
- ADR 0009's "#433's port contract stands unchanged" is superseded for the
  local backend's env-var half; the `hostPort` seam, proxy/ttyd resolved-port
  binding, and the named failure mode all stand.
