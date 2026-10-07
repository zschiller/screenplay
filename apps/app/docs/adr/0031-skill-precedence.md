# 31. Skill precedence: repo, canvas, account, agent, app; on the Mac the harness keeps its own skill loading

Date: 2026-10-03

Status: Accepted (backfilled 2026-10-07)

## Context

Skills reach a chat from five places: the repo's own (`.agents/skills`), the
canvas's saved skills, the person's account skills, the Mac coding agent's own
skills (for example `~/.claude/skills`), and Screenplay's built-in App Skills.
Two sources can share a name, and Claude Code and Codex already load repo and
user skills themselves.

## Decision

- **First source with a name wins, whole**: repo, then canvas, then account,
  then the agent's own, then App (`SKILL_ORIGIN_RANK` in
  `lib/skills/sources.ts`, spec #1554). The winner supplies the index row, the
  body and the files.
- **On the Mac the harness keeps its own loading.** Screenplay writes the
  winning skill of each name to a context folder outside the checkout and
  passes it as an extra directory, but leaves out names the harness loads
  itself (repo and its own), so it doesn't fight the harness.
- **The Coordinator gets no repo skills** (#1533).

## Consequences

- A repo can override any built-in skill by naming one the same; a team's
  canvas skill beats a person's account one.
- App Skills are the floor: anything else with the name replaces them.
- What a desktop harness sees for its own skills is the harness's business.

Rejected: Screenplay managing the harness's own skill loading on the Mac;
merging same-named skills.
