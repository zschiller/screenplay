# 33. Agents never type into a person's terminal tabs

Date: 2026-09-29

Status: Accepted (backfilled 2026-10-07)

## Context

PR #1134 gave chat agents dev-server tools: read the preview's logs and restart
it (later also stop and start). The obvious next step was letting an agent type
into the chat's terminal tabs, which people use to run commands, and often a
coding harness, by hand.

## Decision

- **Agents have no tool that writes to a terminal tab.** They already have
  their own shell in the sandbox.
- **The dev server is reached through its own tools**
  (`lib/agent/dev-server-tools.ts`), which act like the terminal pane's Run and
  Stop, not by typing.

## Consequences

- A person's terminal stays theirs: an agent can't interrupt a running
  harness or command, or act as them in it.
- Anything an agent needs to run, it runs in its own shell, so its output isn't
  in a tab people watch.

Rejected: an agent typing into, or reading from, terminal tabs.
