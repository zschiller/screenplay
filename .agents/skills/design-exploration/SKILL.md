---
name: design-exploration
description: Design exploration answers one design question with lettered options on one page, and ends at recording the owner's pick. Use when asked to explore, mock up, compare or rethink how a screen, flow, component or visual system should look or work.
---

# Design exploration

An **exploration** answers one design question with **options**: distinct, lettered answers (A, B, C) shown side by side on one published Artifact, next to **Today** (what main does now). A **round** is one pass of options; the owner's reaction starts the next. A **pick** is the owner's answer. An exploration ends when its picks are recorded; building starts only when the owner asks for it.

An exploration is the sibling of [`design-audit`](../design-audit/SKILL.md): an audit finds many problems across a surface and asks its calls on a decisions page; an exploration takes one question (the owner's, or one audit call that needs mockups to answer) and settles it. For a question that needs working code to feel out, such as an interaction or a state model, build a prototype instead (the `prototype` skill when the repo has one).

## 1. Frame the question

1. Quote the owner's words at the top of the page, then state the question in one line. The options answer that question and no other: every option traces to the owner's words or to a fact in the code. An example you invent to explain an option stays an example, not an option.
2. Take an **inventory** of Today on main: every place the thing appears, with real captures, and the numbers that matter (sizes, colours, counts, which component). Measure them from the DOM rather than eyeballing a screenshot. List the facts that constrain the answer, citing `file:line`.
3. Gather the owner's design rules as [`RULES.md`](RULES.md) describes, and read the exploration's own topic file if this is a later round. Drop any option that a rule or an earlier rejection already settles.

Done when the question is one line, Today is captured and measured, and every constraint has a citation.

## 2. Pick the fidelity

- **Structural** questions (where something lives, what the unit of work is, what a flow's first step is, what appears at which level): broad **wireframes**, grey boxes and real labels, several combinations of answers. Polish here is wasted and hides the structure.
- **Visual** questions (type, colour, size, spacing, iconography, a component's look): **real screens** in every theme the product ships, restyled by injecting CSS or JS into captures of the running product. Hand-drawn mockups of existing UI drift from the product; real captures don't. [`CAPTURE.md`](CAPTURE.md) has the techniques.

Keep captures **targeted**: only the handful of screens where the thing appears.

## 3. Build the page

One Artifact per exploration, built from `exploration-template.html` next to this file. Load `artifact-design` first, then fill in the template's `QUESTION`, `TODAY` and `ROUNDS` data and swap its `:root` tokens for the repo's brand. The template draws the round toggle, Today, each option's captures and badges, and a reaction form with Copy reaction.

- **Today** first, then 3 or 4 options. Each option gets its letter and a short name ("B: Panel's home"), its captures or wireframe, a few sentences of rationale, and what it costs or breaks.
- Options are **distinct**: a different answer to the question, not a spacing tweak of another option. When the owner says a round looks samey, the next round goes further apart.
- Stay inside the product's system: its component library and existing variants, its tokens, and the conventions of the tools the owner names. When an option needs a new variant or a one-off component, list that as its cost.
- Mark one **recommended** option and give the reason in one sentence. Prefer the small fix inside today's UX over the redesign when both answer the question.
- Later rounds go on the same Artifact so the link never changes: add each new round at the front of `ROUNDS` with the owner's feedback, and mark earlier options `picked` or `rejected`. An Artifact version holds at most 511 files: delete captures from rejected rounds (`null` in `files`) before adding more.

## 4. Critique before showing

Open every capture at full size and review it as the owner will: alignment against neighbours, spacing, type sizes, contrast in every theme, anything clipped or flush to an edge. A defect visible in any shot is the exploration's to fix, even when main already has it; fix it in the mockup and note it. Check each option against every rule from step 1.

Done when every capture has been looked at in every theme and nothing visibly off remains.

## 5. Ask for the pick

Reply with the link and one line on the recommendation. The owner can react on the page and paste back its copied text. Ask each open question on its own, with 2 to 4 options and the recommendation marked. Use a decision card when the chat surface has one.

When the owner reacts:

- A pick settles that question. Say which option you follow in one line.
- A rejection ends that direction. Record it in the topic file's never-re-offer list, and build the next round from what the owner said they wanted, not a variant of what they rejected.
- Details the owner wants to decide themselves stay open: ask them, rather than defaulting to your pick.

## 6. Record the picks

Once every question has a pick:

1. Write or update the exploration's topic file in memory (`<subject>-exploration`): the owner's quote, the Artifact link, the options, each round's feedback, the picks, the never-re-offer list, and how the captures were made.
2. Reply with the picks in one line each, linking the Artifact, and stop there. Tickets, triage labels and build threads come later, from the owner: the exploration hands them its record and leaves creating them to the owner's own ask.

Done when memory holds every pick, the owner has the summary, and the tracker is unchanged.

## When the owner asks to build

Only on the owner's explicit ask to build a pick: draft tickets from the topic file with the repo's ticketing skill (such as `to-tickets`, or `to-spec` for one larger change), each linking the Artifact and naming the option picked, and show them to the owner. Labels and dependencies follow the tracker's docs and the owner's answer. Each ticket is built in its own thread and PR, with the screenshots RULES.md's PR evidence rule asks for.
