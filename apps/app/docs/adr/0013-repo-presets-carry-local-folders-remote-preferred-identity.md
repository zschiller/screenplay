# 13. Project presets can be local folders, with remote-preferred identity

Date: 2026-06-15

Status: Accepted

## Context

A **Repo Config** (Project preset — see CONTEXT.md) was GitHub-shaped: keyed by
`repoFullName`, carrying a `cloneUrl` but no local path. The in-Room "Add
project" picker already accepts three sources on desktop (a GitHub pick, a
pasted clone URL, or a local folder via `localSources`), but the homepage preset
form rendered a bare `RepoPicker` whose `onSelect` dropped every pick except
`kind: "repo"` — so a preset could only ever be made from a GitHub repo. As we
unify the picker into one component used by **both** surfaces (web: a modal
combining URL entry + GitHub list; desktop: a dropdown of "GitHub / URL" vs
"Open a folder"), the homepage gains URL and folder sources too — which forces
the question of what a folder-sourced preset is *identified by*, since a local
folder may have no GitHub remote at all.

## Decision

- **`RepoConfig` gains an optional `localPath`.** A preset can now represent a
  local checkout, not just a remote repo. The field is desktop-only in practice
  (the hosted build never produces folder sources) and is the **acquisition
  hint**: adding such a preset to a Room points the Repo at *that existing
  checkout*, never a re-clone.

- **Identity prefers the detected git remote.** `inspectLocalRepoPath` already
  derives `repoFullName` / `cloneUrl` from a folder's remote. When present, the
  preset is keyed, grouped, and displayed by that `repoFullName` — so a
  folder-added preset for `owner/repo` lands in the *same* list group as a
  GitHub- or URL-added one and dedupes naturally. Only a genuinely remote-less
  folder falls back to **path identity** (list heading = the folder's basename,
  full path as muted subtext, a distinct local-folder icon).

- **The remote names it; the path opens it.** Detecting a remote changes only
  identity/display, never acquisition: a preset may carry *both* a
  remote-derived `repoFullName`/`cloneUrl` and a `localPath`, and the seed step
  uses the `localPath` to point at the existing clone. This mirrors the Repo
  glossary entry ("resolves to a local `.git` two ways… both converge").

## Consequences

- The KV-persisted `RepoConfig` schema changes (a new optional field, encrypted
  at rest) — hence this record; readers predating it won't carry `localPath`,
  which is fine (absence = a non-folder preset).
- The homepage preset list (`RepoConfigsPanel`) grows a second grouping case
  (remote vs path identity) rather than a second top-level section — most local
  folders are clones and resolve to a remote, so the path-keyed group is the
  rare tail and doesn't earn co-equal billing.
- The one-way seed (preset → `RepoData`) is unchanged; `localPath` simply rides
  along as one more seeded field.
