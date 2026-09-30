---
name: design-audit
description: Audit several product surfaces at three depths, combine each surface into one sequenced PR plan, then collect the user's calls on an interactive decisions page and fan out one thread per PR.
---

# Design audit

Use when the user wants a surface (homepage, docs, app, ...) audited end to end and turned into work, or asks for any stage of that: the audits, "combine the audits", "a page where I can answer the questions", or "spin up the work from my decisions". Each stage produces an Artifact. Nothing is ticketed or opened until the user has answered the decisions page.

## Stage 1: audits (one thread per surface × depth)

Default depths, each its own thread and Artifact:
- **Product**: is every claim true, what is missing or wrong for a real user. Check claims in code and cite `file:line`.
- **Interaction / hierarchy** (wayfinding for docs): what a person sees first, what they can reach, where flows dead-end.
- **Visual nits**: spacing, type, colour and component drift against the project's design rules. Build the fixes as a patch or branch (`/mnt/project-files/<surface>-visual-nits/fixes.patch`) with before and after captures in light and dark.

Every finding gets a tag: depth letter + number (P3, H7, N12, or V/I/D as the surface uses). Captures are labelled Now, Mockup or After. Check findings against project memory's design rules and "don't re-raise" lists before including them.

## Stage 2: combined plan (one thread per surface, after all its audits are done)

Read that surface's audits and produce one Artifact, in this order:
1. **Header**: surface, date, a lede with the counts (findings, overlaps merged, proposed PRs, decisions needed), and links to each source audit (and any built branch or patch).
2. **The sequence**: numbered PRs in the order you'd do them. Each: title, size and kind ("Copy only · 6 files"), and what it depends on. Put false claims and bugs first, already-built patches early, and big redesigns after the PRs they build on. Note steps that need the user's machine (a release, a Mac-only test).
3. **Needs your call**: numbered questions, each with its question in one line, the finding tags and PR it gates, one or two sentences of context, and 2 or 3 options with a one-line consequence. The recommended option comes first and is marked. Say which PRs can start without any of the answers.
4. **Worth your oversight**: things you'll do by default that the user may want to watch (a release, copy that changes the pitch, a change everyone on a canvas sees, unverified captures, edits another surface's plan depends on).
5. **Defaults I picked and what was merged**: duplicates across audits ship once (say where), findings dropped and why, and a check against the user's design rules.
6. **Per-PR sections**: why, depends on, touches (files), then each finding with its tag, the concrete change, and its captures copied from the audit Artifacts (`files` with `{artifact, path}` sources, so nothing is downloaded).
7. **Out of scope**: items moved to another surface's plan (for example, product bugs found by the docs audit go to the app plan).

## Stage 3: decisions page (one Artifact for all surfaces)

1. Read each combined plan with the Artifact tool. For long pages, extract `<section class="pr">` blocks, headings and image `src` plus caption with a short script instead of reading the whole file.
2. For each call, fill a question object in `decisions-template.html`'s `SURFACES` array: id (surface letter + number: H1, D3, A2), `where`, `t` question, `c` context, `o` options (recommended first), and `img` with the one or two captures that show the thing decided (light plus dark when the plan has both). Leave `img` off when no capture shows it, rather than adding one that's loosely related.
3. Fill `RUNS` with every PR per surface: `""` for runs regardless, `"waits on H1, H3"` where it's gated.
4. Copy `decisions-template.html` (next to this file), replace the `{{...}}` placeholders and the jump and plan links. Load `artifact-design` first, keep the template's tokens, extract the script and run `node --check` on it once, then publish with `files` mapping each image path to `{artifact: <plan url>, path: <its published path>}`.
5. Reply with the link: pick answers, press Copy decisions, paste the text back. Blank means the recommendation stands.

The copied text looks like this:

```
Decisions on the homepage, docs and app audit plans (30 Sep 2026)

HOMEPAGE
H1. Should the figures sell versions of one change, or parallel tasks?
   → Versions (recommended)
H6. Swap Pick elements for a Play mode card?
   → None of these
   Note: pick elements is useful. Let's think about what these cards should be.
```

## Stage 4: take the answers and fan out

- Record the answers in project memory next to the plans, spelling out every non-recommended answer and every note.
- Notes often ask a question ("didn't we have it?", "do we even need this?"). Answer each one from the code or git history, citing the PR or `file:line`. A note that says "file an issue" means filing it now, with the repo's triage label (`needs-triage`).
- A "None of these" answer with a note that reopens the question: drop that item from its PR and list it as an open discussion.
- Reply once in the thread with the answers to the notes and what changed in the plan.
- Hand the answers to the coordinator (or start the threads yourself if you are the coordinator): one thread per PR, each briefed with its plan link, its PR section and the answers it waits on. PRs marked "runs regardless" can start at once; steps that need the user's machine go through Remote Control.

## Decisions page template

`decisions-template.html` in this folder is the page. Its `homepage` entries in `SURFACES` and `RUNS` are examples to replace; everything below the data arrays (rendering, None of these and Write my own, notes, the answered count, Copy decisions with its select-text fallback, localStorage drafts) works as is.
