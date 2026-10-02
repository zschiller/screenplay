# PROTOTYPE: how big a Workspace Sandbox needs to be with live frames (#1384)

Throwaway, not for main. Runs the [live frame prototype](../webrtc.prototype) (copied from
`claude/project-thread-f2mdmm`) on real Vercel Sandboxes of 2, 4 and 8 vCPUs, next to a Next.js dev
server (apps/homepage) that the "agent" keeps editing, and measures what viewers get.

```sh
cd apps/app/lib/live-frame/sizing.prototype && npm i
node run.mjs [--vcpus 2,4,8] [--frames 1,2,3] [--pages still,busy] [--loads idle,edits,tsc]
```

- `run.mjs` (runs here): creates a viewer Sandbox and, per size, a stream Sandbox; runs every
  scenario; appends to `results.jsonl`; stops every Sandbox at the end.
- `edit-loop.mjs` (in the stream Sandbox): edits apps/homepage's page every 4 s (new text and a new
  Tailwind class) and times edit to new HTML from the dev server. `--tsc` also loops `tsc --noEmit`.
- `sysstat.mjs` (in the stream Sandbox): whole-Sandbox CPU and memory.
- Loads: `idle` (dev server up, no edits), `edits`, `tsc` (edits plus a back-to-back typecheck).
- Frames run at 60 fps with unchanged frames skipped (`--decimate`, as #1368 decided), all watched.

Auth: `VERCEL_OIDC_TOKEN` (expires 12 h after `vercel env pull`), or `VERCEL_TOKEN` +
`VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`.

Checked locally (4-core container): the edit loop sees each edit in 0.5–1 s, tsc takes 2–4 s.
