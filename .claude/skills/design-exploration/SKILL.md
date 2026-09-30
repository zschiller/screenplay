---
name: design-exploration
description: Design exploration answers one design question with lettered options on one page, then tickets the owner's pick. Use when asked to explore, mock up, compare or rethink how a screen, flow, component or visual system should look or work.
---

# Design exploration

An **exploration** answers one design question with **options**: distinct, lettered answers (A, B, C) shown side by side on one published Artifact, next to **Today** (what main does now). A **round** is one pass of options; the owner's reaction starts the next. A **pick** is the owner's answer. Nothing is built or ticketed until the pick.

An exploration is the sibling of [`design-audit`](../design-audit/SKILL.md): an audit finds many problems across a surface and asks its calls on a decisions page; an exploration takes one question (the owner's, or one audit call that needs mockups to answer) and settles it. For a question that needs working code to feel out, such as an interaction or a state model, use [`prototype`](../prototype/SKILL.md) instead.

## 1. Frame the question

1. Quote the owner's words at the top of the page, then state the question in one line. The options answer that question and no other: every option traces to the owner's words or to a fact in the code. An example you invent to explain an option stays an example, not an option or a ticket.
2. Take an **inventory** of Today on main: every place the thing appears, with real captures, and the numbers that matter (sizes, colours, counts, which component). Measure them from the DOM rather than eyeballing a screenshot. List the facts that constrain the answer, citing `file:line`.
3. Read project memory's design rules (the "Design rules" section of `MEMORY.md` and the topic files it names) and the exploration's own topic file if this is a later round. [`RULES.md`](RULES.md) holds the standing rules as of this skill's last edit; memory wins where they differ. Drop any option a rule or an earlier rejection already settles.

Done when the question is one line, Today is captured and measured, and every constraint has a citation.

## 2. Pick the fidelity

- **Structural** questions (where something lives, what the unit of work is, what a flow's first step is, what appears at which level): broad **wireframes**, grey boxes and real labels, several combinations of answers. Polish here is wasted and hides the structure.
- **Visual** questions (type, colour, size, spacing, iconography, a component's look): **real screens**, restyled by injecting CSS or JS into the screenshot harness's captures, in light and dark. Hand-drawn mockups of existing UI drift from the product; real captures don't. [`CAPTURE.md`](CAPTURE.md) has the techniques.

Keep captures **targeted**: the handful of screens where the thing appears, named with `--screens`, never a full sweep.

## 3. Build the page

One Artifact per exploration. Load `artifact-design` first.

- **Today** first, then 3 or 4 options. Each option gets its letter and a short name ("B: Panel's home"), its captures or wireframe, a few sentences of rationale, and what it costs or breaks.
- Options are **distinct**: a different answer to the question, not a spacing tweak of another option. When the owner says a round looks samey, the next round goes further apart.
- Stay inside the product's system: stock shadcn components and variants, existing tokens, conventions from the tools the owner names (GitHub, Figma, Claude). An option that needs a new variant or a bespoke pill says so as its cost.
- Mark one **recommended** option and give the reason in one sentence. Prefer the small fix inside today's UX over the redesign when both answer the question.
- Later rounds go on the same Artifact, newest round at the top behind a round toggle, so the link never changes. An Artifact version holds at most 511 files: delete captures from rejected rounds (`null` in `files`) before adding more.

## 4. Critique before showing

Open every capture at full size and review it as the owner will: alignment against neighbours, spacing, type sizes, contrast in both themes, anything clipped or flush to an edge. A defect visible in any shot is the exploration's to fix, even when main already has it; fix it in the mockup and note it. Check each option against every rule from step 1.

Done when every capture has been looked at in both themes and nothing visibly off remains.

## 5. Ask for the pick

Reply with the link and one line on the recommendation. Ask each open question as its own `ask_decision` card: 2 to 4 options, the recommendation marked, one card per question. A reply lists no questions.

When the owner reacts:

- A pick settles that question. Say which option you follow in one line.
- A rejection ends that direction. Record it in the topic file's never-re-offer list, and build the next round from what the owner said they wanted, not a variant of what they rejected.
- Details the owner wants to decide themselves stay open: ask them, rather than defaulting to your pick.

## 6. Record and ticket

Once every question has a pick:

1. Write or update the exploration's topic file in project memory (`<subject>-exploration`): the owner's quote, the Artifact link, the options, each round's feedback, the picks, the never-re-offer list, and how the captures were made.
2. File one ticket per decision with `/to-tickets` (or `/to-spec` for one larger change), each linking the Artifact and naming the option picked, labelled with the ready-for-agent role from `docs/agents/triage-labels.md`, with GitHub native blocked-by edges between them.
3. Resolve the exploration thread. Building happens in one thread per ticket, one PR each, with before and after screenshots of the screens the ticket touches.

Done when memory holds the picks, every decision has a ticket linking the Artifact, and the tickets' blocking edges are set.
