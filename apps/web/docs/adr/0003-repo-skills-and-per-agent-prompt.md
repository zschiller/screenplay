# 3. Repo Skills, and the agent prompt going per-Agent

Date: 2026-05-30

Status: Accepted

## Context

Today a **Skill** (CONTEXT.md) exists only as an **App Skill**: a `SKILL.md`
that screenplay ships in its own `lib/skills/`, read server-side from the
deployed app's `process.cwd()`. `buildAgentSystemPrompt` folds every App Skill's
`name` + `description` into the agent system prompt, and the model loads a body
on demand via the `read_skill` tool — Anthropic's Agent Skills progressive
disclosure (Level 1 metadata always-loaded; Level 2 body on trigger), routed
through our own tool. That prompt is a single, shared, cached artifact: it is
identical for every Agent regardless of branch, and `SKILLS_HASH` rolls it only
when an App Skill's source changes.

We want `/`-autocomplete for skills in the agent composer, and — the deciding
requirement — the menu must include **skills in the Agent's checked-out repo on
its branch**, not just screenplay's bundled ones. That introduces a second
source, the **Repo Skill** (`.claude/skills/` in the Agent's sandbox), which is
the Claude Code project-skill convention and varies per branch.

The canonical Agent Skills model is that *all* skill metadata — bundled and
project-local alike — is preloaded into the system prompt so the model can
**auto-discover** any skill, with explicit `/` invocation layered on top as a
second, parallel path (Claude Code's `user-invocable` / `disable-model-invocation`
flags decouple the two axes). We chose to honor that model rather than treat `/`
as the only way a Repo Skill reaches the model.

The friction: in Claude Code, skills sit on the same local filesystem as the
process building the prompt, so globbing them is free. In screenplay the prompt
is built **server-side** while Repo Skills live in a **remote sandbox VM**, and
the prompt is **cached**. Honoring auto-discovery therefore means the prompt can
no longer be a single shared artifact.

## Decision

- **Repo Skills are a first-class skill source, merged with App Skills.** The
  agent system prompt folds in `name` + `description` for **both** sources, so
  the model auto-discovers a Repo Skill the same way it does an App Skill. `/`
  is an *additional* explicit-invocation layer over the same merged list, not a
  replacement for auto-discovery.

- **The agent system prompt becomes per-Agent, not a shared cached artifact.**
  The sandbox's `.claude/skills/*/SKILL.md` is globbed and frontmatter-parsed
  once at chat init and baked into that Agent's prompt; the prompt's cache key
  extends the `SKILLS_HASH` idea to fold in a hash of the repo-skill index, so a
  branch that adds or edits a Repo Skill gets a fresh prompt. We accept one
  sandbox round-trip at chat init and the loss of the "one prompt for every
  Agent" assumption as the cost of canonical behavior.

- **`read_skill` resolves sandbox-first, then app.** A Repo Skill **shadows** an
  App Skill of the same name (CONTEXT.md), so a user can override a bundled
  skill from their checked-out repo. To keep collisions rare and intentional,
  bundled skills are namespaced with a `screenplay-` prefix
  (`screenplay-add-knob`, `screenplay-share-state`).

- **Skills stay scoped to Agent (sandbox) chats.** Document/Markdown-Layer chats
  get no `/` menu and no skill metadata: they have no sandbox to glob, their
  toolset has no `read_skill`, and the current App Skills are about sandbox code.
  Workspace-level skills are a deliberate non-goal for now.

## Consequences

- `buildAgentSystemPrompt` gains a dependency on the sandbox (to enumerate Repo
  Skills) and must run per-Agent; the shared-prompt fast path is gone for agent
  chats. The frontmatter parser in `lib/skills/index.ts` should be extracted so
  both the App-Skill loader and the sandbox Repo-Skill enumerator share it.
- `read_skill` (a sandbox tool — `ToolContext` already carries `sandboxName`)
  grows a resolution order: read `.claude/skills/<name>/SKILL.md` off the
  sandbox first, fall back to `getSkill(name)`.
- The composer needs a merged skill index client-side to render the `/` menu —
  App Skills via a server action over `getSkillIndex()`, Repo Skills via the
  sandbox glob — fetched once on chat open and deduped Repo-wins.
- **Repo Skills are user-supplied instructions executed by the agent.** This is
  acceptable under the same single-trusted-operator boundary as ADR 0002: the
  checked-out repo is the operator's own. If screenplay ever goes multi-tenant,
  auto-loading branch-supplied skill instructions must be revisited alongside
  the egress/no-metering constraints recorded there.
- Reversible-but-costly: collapsing back to a static shared prompt later means
  giving up Repo-Skill auto-discovery, which is the whole point of this change.
