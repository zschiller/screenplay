---
name: design-audit
description: Design audit of a repo's user-facing surfaces, run in four stages. Use when asked to audit a product, site or docs, combine audits into a plan, put a plan's calls on a decisions page, or start the work from pasted decisions.
---

# Design audit

A **surface** is one user-facing product area, such as a marketing site, a docs site, a web or desktop app, or a CLI. A **depth** is one lens on a surface. A **call** is a question only the owner can answer. Each stage runs in its own thread and produces a published Artifact. Tickets and PRs start in stage 4, once the owner has answered the calls.

Work out from the ask which stage you are in, then do that stage only.

## 0. Surfaces and rules (before the first audit)

1. **Surfaces**: read the repo's layout to find what people actually see.
   - In a monorepo, start from the workspace config (`pnpm-workspace.yaml`, `package.json` workspaces, `turbo.json`, `nx.json`, `Cargo.toml` workspace, `go.work`) and list the deployable apps. Shared packages are not surfaces.
   - In a single-app repo, the app is one surface. Also count a docs folder or site, and a marketing page when it has its own route tree.
   - Give each surface a one-letter id, and make the ids unique across the audit.
2. **Rules**: gather the design rules the audits check against, as [`../design-exploration/RULES.md`](../design-exploration/RULES.md) describes. Also collect the settled lists that memory keeps: findings already filed and decisions already rejected.
3. **Run**: find how each surface starts locally and how to capture it in every theme it ships, following [`../design-exploration/CAPTURE.md`](../design-exploration/CAPTURE.md). Use the repo's screenshot harness if it has one; otherwise use Playwright against the dev server.

Done when every surface has an id, a start command and a capture method, and the rules list names its sources.

## 1. Audit: one thread per surface × depth

The three depths:

- **Product**: whether every claim is true, and what a real user is missing. Cite the code (`file:line`) for each claim you check.
- **Hierarchy**: what a person sees first, what they can reach, and where flows dead-end. For a docs surface this is wayfinding; for an app it's interaction.
- **Visual nits**: spacing, type, colour and component drift against the rules from stage 0. Build the fixes as a patch or branch, with before and after captures in every theme.

Tag each finding with its depth letter and a number (P3, H7, N12). Label each capture Now, Mockup or After. Leave out anything the settled lists from stage 0 already cover.

Done when every finding has a tag, every product claim has a citation, and every visual finding has captures.

## 2. Combine: one thread per surface, after all three audits are done

Read [`PLAN.md`](PLAN.md) and build the surface's combined plan.

Done when every finding from the three audits is accounted for exactly once: in a PR, merged into another finding, dropped with a reason, or moved to another surface's plan.

## 3. Decide: one page for all surfaces

Read [`DECISIONS.md`](DECISIONS.md) and build the decisions page from `decisions-template.html`. A call the owner can only answer by seeing mockups runs as a [`design-exploration`](../design-exploration/SKILL.md) instead, when that skill exists, and its pick comes back as the answer.

Done when every call in every plan is either a question on the page or its own exploration, and every PR is in its runs list.

## 4. Fan out: when the owner pastes their decisions back

1. Record the answers in memory next to the plans. Write out every answer that differs from the recommendation, and every note.
2. Answer each question asked in a note from the code or git history, citing the PR or `file:line`. When a note asks for an issue, file it now in the repo's tracker with its triage label (see `AGENTS.md` or `docs/agents/`).
3. When the answer is "None of these" and the note reopens the question, take that item out of its PR and list it as an open discussion.
4. Start one thread or agent per PR, and brief each with its plan link, its PR section and the answers it waits on. PRs that wait on no call start first. Steps that need the owner's own machine run there.

Done when every note has an answer and every PR has a thread whose brief carries the answers it depends on.
