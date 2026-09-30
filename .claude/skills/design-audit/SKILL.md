---
name: design-audit
description: Design audit of a product surface, run as four stages. Use when asked to audit a surface, combine its audits into a plan, put the plan's calls on a decisions page, or start the work from pasted decisions.
---

# Design audit

A **surface** is one product area (homepage, docs, app). A **depth** is one lens on it. A **call** is a question only the owner can answer. The four stages run in separate threads, and each produces a published Artifact. Tickets and PRs start in stage 4, once the owner has answered the calls.

Find which stage you are in from the ask, then do only that stage.

## 1. Audit: one thread per surface × depth

The three depths:

- **Product**: whether every claim is true and what a real user is missing. Cite the code (`file:line`) behind each claim you check.
- **Hierarchy** (wayfinding for docs, interaction for the app): what a person sees first, what they can reach, and where flows dead-end.
- **Visual nits**: spacing, type, colour and component drift against the design rules in project memory. Build the fixes as a patch in `/mnt/project-files/<surface>-visual-nits/`, with before and after captures in light and dark.

Tag each finding with its depth letter and a number (P3, H7, N12). Label captures Now, Mockup or After. Check memory's "don't re-raise" list first, and keep only findings it doesn't already settle.

Done when every finding has a tag, every product claim has a citation, and every visual finding has captures.

## 2. Combine: one thread per surface, after all three audits are done

Read [`PLAN.md`](PLAN.md) and build the surface's combined plan.

Done when every finding from the three audits is accounted for exactly once: in a PR, merged into another finding, dropped with a reason, or moved to another surface's plan.

## 3. Decide: one page for all surfaces

Read [`DECISIONS.md`](DECISIONS.md) and build the decisions page from `decisions-template.html`.

Done when every call in every plan is a question on the page and every PR is in its runs list.

## 4. Fan out: when the owner pastes their decisions back

1. Record the answers in project memory next to the plans. Write out every answer that isn't the recommendation, and every note.
2. Answer each question asked in a note from the code or git history, citing the PR or `file:line`. When a note asks for an issue, file it now with the label for the needs-triage role in `docs/agents/triage-labels.md`.
3. When the answer is "None of these" and the note reopens the question, take that item out of its PR and list it as an open discussion.
4. Start one thread per PR, or ask the coordinator to. Brief each with its plan link, its PR section and the answers it waits on. PRs that wait on no call start first. Steps that need the owner's machine run over Remote Control.

Done when every note has an answer and every PR has a thread whose brief carries the answers it depends on.
