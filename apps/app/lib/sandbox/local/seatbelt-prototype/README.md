# Seatbelt dev-server spike (PROTOTYPE, issue #992)

Throwaway code answering "Does a dev server still work inside the isolation research picked?" (map: "Wayfinder: Share a room from the Mac"). Nothing in the app imports it. It lives on a branch, not `main`.

## Run it (on the Mac)

```sh
git fetch origin claude/project-thread-nxp4d8
git worktree add /tmp/seatbelt-992 origin/claude/project-thread-nxp4d8
bash /tmp/seatbelt-992/apps/app/lib/sandbox/local/seatbelt-prototype/run.sh
```

It takes a few minutes (two `npm install`s and four dev-server starts). It works only in `~/.screenplay/seatbelt-992`, which it wipes at the start, and writes `report.md` there. `--probes-only` skips the real dev servers; `--skip-next` skips the Next app.

## What it does

- `profile.mjs` generates the Seatbelt profile. It is srt's profile shape with three changes: loopback limited to the dev port, no SecurityServer (keychain), and FSEvents as an opt-in. Reads are allowed except `$HOME`, which is denied apart from the worktree, the sandbox's own state dir and the node install. Writes go only to the worktree and the state dir. Sandboxed processes get a private `HOME` and `TMPDIR` in the state dir.
- **Part 1** runs `probe-inside.mjs` under each profile: reading `~/.ssh`, `gh` config and the keychain token (it reports only the token's length), writing outside the worktree, binding ports, connecting to two host loopback stand-ins (terminal socket, Yjs), the real `:1234`, ssh-agent, and the internet, and a directory `fs.watch` (FSEvents).
- **Part 2** takes the docs demo site (Northwind, Vite) and a minimal Next 16 app, runs `npm install` sandboxed under the install profile (egress to `:443`/`:80` stands in for srt's domain proxy), then runs each dev server sandboxed with and without FSEvents. The real bridge proxy (`apps/app/lib/sandbox-bridge/proxy.mjs`) runs unsandboxed in front of it. It checks that the page loads through the proxy with the bridge injected, that the HMR socket opens through the proxy, and that an edit made from outside the sandbox produces an HMR message and a fresh compile.
- Every denial the kernel logs for the run is summarized in the report, so it shows what each dev server tried that was blocked.

## Not covered

- Portless stays outside the sandbox, as the research proposes, so it isn't in the loop here.
- A `local-path` repo's worktree `.git` points back into the user's checkout; this spike uses a self-contained repo.
- srt itself isn't run. The "srt-like" column reproduces its two gaps (SecurityServer, `localhost:*`) in this profile.
