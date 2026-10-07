# 29. Canvas env var values are encrypted outside the room doc, and only the person who added them can reveal them

Date: 2026-10-03

Status: Accepted (backfilled 2026-10-07)

## Context

A repo's environment variables (`RepoData.envVars`) were plaintext in the room
doc, which syncs to every member of the canvas and is stored by Liveblocks or
in desktop files (#1416). Secrets like API keys were readable by anyone on the
canvas.

## Decision

- **Values live encrypted in KV** at `canvas-repo-env:{roomId}:{repoId}`
  (`lib/repo-env`, PR #1442). The room doc keeps only `envVarNames` and a
  digest. `RepoData.envVars` is legacy; `migrateCanvasEnv` moves old values on
  canvas load.
- **Only the adder can reveal** (`addedBy`, falling back to the canvas owner;
  always on desktop). They see names masked in a locked field and press Reveal
  values to edit the set.
- **Everyone else sees names, can run with the values, and can override** by
  adding `KEY=value` lines that take precedence.
- **Chat output is redacted** with the sandbox's env values
  (`withRedactedOutput` and the ACP stream redactor). Values under 8
  characters are not redacted.

## Consequences

- A member can use a secret without seeing it, and the room doc never carries
  one.
- If the adder leaves, nobody else can read the values; they can only
  override them.
- A process inside the sandbox still has the values; redaction catches echoes
  in chat output, not deliberate exfiltration.

Rejected: plaintext in the room doc; any member revealing values; an override
mode for the adder.
