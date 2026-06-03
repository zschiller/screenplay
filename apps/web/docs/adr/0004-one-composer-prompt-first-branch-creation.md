# 4. One prompt-first Composer for Branch creation — "New Workspace"

Date: 2026-06-03

Status: Accepted

## Context

Creating a Branch on a Repo row meant choosing between **three** overlapping
entrypoints crammed onto a single row: a "Parallel agents" grid (many Branches
at once, each with its own base, model, and prompt), a "from existing branch"
picker that hid a copy-vs-open distinction behind a keyboard modifier (Enter
opens, ⌘↵ forks), and a one-click "copy from main" button. Two of the three
created Branches in subtly different ways; the only place a user could express
real intent — a starting prompt for the agent — lived exclusively in the
heaviest of the three (the grid); and the common case (one Branch off main,
maybe with a prompt) was split across buttons. The "Parallel agents" label even
miscalled Branches "agents", in conflict with the glossary (an Agent is the
Engine, never a Branch).

The grid also carried its **own** prompt input, model picker, and model-default
logic — a second, divergent copy of the chat input surface that had to be kept
in step with the real Composer by hand.

#314 consolidates the three into a single prompt-first **"New Workspace"**
dialog per Repo row, built on the **same `Composer`** used in chat and rendered
**before the Sandbox exists**. This ADR records the decision, the seam it
deliberately accepts, and the one keyboard-ergonomics convention it settles, so
implementers (#314's child issues) build against a fixed contract rather than
re-deriving it. CONTEXT.md already gains the **Composer** and **Message
Markers** glossary entries; this ADR owns the *why* of the consolidation and the
pre-Sandbox trade-off it accepts.

## Decision

- **One dialog, one Composer.** Each Repo row collapses to a single primary
  **"New Workspace"** button plus a `…` overflow menu. The new
  `CreateBranchDialog` opens focused on the **same `Composer` component used in
  chat**, with `Base: <defaultBranch> ▾` and `Model: ▾` rendered as chips beside
  it. There is no second prompt input to maintain: the Composer is extracted
  from the chat component and decoupled from the chat-session hook and a live
  chat id so it can render before a Sandbox exists, and it keeps serializing to
  **Message Markers** through the one unchanged codec.

- **Prompt-presence is the sole behavior switch.** The user sees one input, not
  a copy-vs-new verb. The presence of seed-prompt text — nothing else — decides
  the outcome:
  - **Empty prompt** → a bare Branch off the default branch with a random
    `adjective-color-animal` name, **no Chat Session** seeded, no model applied,
    and nothing fired on `running`. This replaces the old one-click copy-main.
  - **Non-empty prompt** → a name derived from the prompt
    (`autoNamedBranch: true`), a **seeded Chat Session** carrying the chosen
    model, and the prompt **fired as the first message** once the Sandbox
    reaches `running`. This is the old parallel-row behavior, for a single
    Branch.

- **Base-selection subsumes new-vs-fork.** `flow` is *derived* from the chosen
  base — `base === defaultBranch → "new"`, otherwise `"duplicate-branch"` — so
  the duplicate-vs-new distinction is never a user-facing verb. This matches the
  existing server behavior, so the **`/api/branch/create` contract is
  unchanged** (`flow: "new" | "from-branch" | "duplicate-branch"` plus its
  existing fields). The base picker reuses the existing cmdk branch list,
  defaults to the default branch, and opens only when the base chip is
  activated.

- **A pure branch-creation planner owns the rules.** The prompt-presence and
  base→flow decisions live in a **pure, isolation-tested** module mapping repo
  context plus an array of Composer specs to one resolved plan per Branch
  (`{ nameSource, flow, seedChat, autoNamedBranch, firePromptOnRunning,
  model? }`). It stays pure: asynchronous name generation lives *outside* it —
  the planner only **flags** which Branches need a generated name; the caller
  resolves names via the existing endpoint and issues the existing create
  requests. The dialog, Composer, and Repo row are shallow UI orchestration over
  this tested core.

- **Parallel is opt-in.** A single Branch is the default; "+ Add another" clones
  the previous row's base and model into another full Composer with an empty
  prompt. Each parallel row carries an independent `{ baseBranch, model,
  prompt }`; non-focused rows collapse to a one-line summary and expand on
  focus. Heterogeneous prompts/bases/models across Branches are preserved, and
  the planner produces one plan entry per spec.

- **"Open existing branch" is demoted to the overflow menu.** Reattaching to a
  remote branch (`from-branch`: no new branch, `autoNamedBranch: false`, no
  prompt, no parallel) is the less-common operation, so it moves off the primary
  flow into the Repo row's `…` overflow menu, reusing the same cmdk picker with
  a single Enter action. The overflow menu also keeps the existing per-Repo
  actions.

- **Seed-Composer keyboard ergonomics — resolved.** In the `CreateBranchDialog`,
  the Composer binds **`⌘↵` (Ctrl+Enter) = create** and **`Enter` = newline**,
  diverging from chat's `Enter` = submit / `Shift+Enter` = newline. Seed prompts
  are routinely multi-line task descriptions, and Branch creation is a heavier,
  less-reversible action than sending a chat turn, so a stray `Enter` must not
  fire it. The submit binding is therefore a per-mount property of the Composer,
  not a global of the component. (This settles the open ergonomic detail noted
  in #314 rather than deferring it.)

## Consequences

- One input surface, not two. The chat Composer is the seed Composer, so model
  selection, plan-mode, `@`-Layer mentions and `/`-Skill insertion behave
  identically in both places for free, and the old grid's duplicated prompt
  input, model picker, and model-default/precedence logic are retired (the
  grouping and default resolution extract into one shared module the Composer
  consumes).
- The 90% case becomes open → type → `⌘↵`; the parallel power case is one
  keystroke ("+ Add another") away; and the scratch case is open → submit empty.
- The decision matrix is pinned independently of any UI: the planner, the
  skill-source resolver, and the model grouping/defaults are pure modules tested
  under vitest with plain inputs (prior art: `message-markers`, `snap`,
  `layout`, `sidebar-order`, `skills/merged`), while the dialog and Composer
  stay thin orchestration.

### Accepted trade-off: App-Skills-only before the Sandbox

The seed Composer renders **before a Sandbox exists**, so the `/`-Skill menu can
offer **App Skills only** at that point — Repo Skills are discovered in the
Branch's checked-out sandbox repo (`.claude/skills/`) and cannot be known until
checkout. The skill-source resolver returns App Skills when no Sandbox is
present and App + Repo Skills (with Repo Skills shadowing App Skills on a name
collision) once one is, rather than bailing entirely pre-Sandbox.

This is an **honest seam, accepted on purpose**: the pre-Sandbox menu never
promises a Skill it cannot yet see, and Repo Skills surface in chat the moment
the Branch is checked out. We take this degradation in exchange for a **single
Composer component** rendered on every surface — the alternative (a Sandbox, or
a speculative Repo-Skill index, standing up before the Branch exists just to
populate the seed menu) would cost far more than the missing Repo Skills are
worth at authoring time. Enabling Repo Skills in the seed Composer before a
Sandbox exists is explicitly out of scope; a real need to preview a specific
Branch's Repo Skills pre-checkout is the event that would reopen this decision.
