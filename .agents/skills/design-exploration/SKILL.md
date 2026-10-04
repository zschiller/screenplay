---
name: design-exploration
description: Design exploration answers one design question with lettered options on one page, over as many rounds as the owner wants. Use when asked to explore, mock up, compare or rethink how a screen, flow, component or visual system should look or work.
---

# Design exploration

An **exploration** answers one design question with **options**: distinct, lettered answers (A, B, C) on one published Artifact, alongside **Today** (what main does now). A **round** is one pass of options; the owner's reaction, picks included, starts the next. A **pick** is the owner's answer to one question in a round. An exploration runs several rounds and keeps going until the owner ends it; sometimes the owner asks for a spec at the end.

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

One Artifact per exploration, built from `exploration-template.html` next to this file. Load `artifact-design` first. The template is a built page: read and edit only the part above its `Generated below this line` marker, where you fill in the `PAGE`, `TODAY` and `ROUNDS` data and swap the token block (shadcn variable names) and font link for the repo's brand. When the repo holds the template's source (the package that builds it), change the page there and rebuild instead. The owner reads the page on a phone as often as on a desktop, so the template is one column of plain tabs at every width: a tab for Today and one per round in time order, opening on the newest; inside a round, each question shows one option at a time behind a segmented A/B/C control that stays pinned while the owner scrolls, so the options outrank the round row; a Pick button on each option; and a bar pinned to the bottom with the picks, a note and Copy reaction.

- **Today** lives on its own tab and nowhere else: short facts with the measured numbers, then its captures.
- A round holds one or more **questions**, each with its own options and pick. Give a question a title when the round has more than one.
- A question with **one option is a sign-off**: the template shows Looks good and Needs changes instead of Pick. Use it when the round shows the picks put together for the owner to approve.
- A question has 2 to 4 options, or one for a sign-off. Each option gets its letter and a short name ("B: Panel's home"), its captures or a drawn wireframe (`html`), a few sentences of rationale, and what it costs or breaks. What every option in the round shares goes in the round's `every` list, not in each option.
- Options are **distinct**: a different answer to the question, not a spacing tweak of another option. When the owner says a round looks samey, the next round goes further apart.
- Stay inside the product's system: its component library and existing variants, its tokens, and the conventions of the tools the owner names. When an option needs a new variant or a one-off component, list that as its cost.
- Mark one **recommended** option per question and give the reason in one sentence. Prefer the small fix inside today's UX over the redesign when both answer the question.
- Later rounds go on the same Artifact so the link never changes: add each new round at the front of `ROUNDS` with the owner's feedback, and mark the previous round's options `picked` or `rejected`, so that round's tab opens on its pick. An Artifact version holds at most 511 files: delete captures from rejected rounds (`null` in `files`) before adding more.

## 4. Critique before showing

Open every capture at full size and review it as the owner will: alignment against neighbours, spacing, type sizes, contrast in every theme, anything clipped or flush to an edge. A defect visible in any shot is the exploration's to fix, even when main already has it; fix it in the mockup and note it. Check each option against every rule from step 1.

Done when every capture has been looked at in every theme and nothing visibly off remains.

## 5. Ask for the pick

Reply with the link and one line on the recommendation. The owner can pick on the page and paste back its copied reaction. Ask each open question on its own, with 2 to 4 options and the recommendation marked; use a decision card when the chat surface has one. A sign-off round asks no question: post the link and say what is being signed off, and the owner answers on the page or in chat.

When the owner reacts:

- A pick settles that question for this round and becomes the starting point of the next: the next round explores what the pick leaves open, or the next question the owner raises. Say which option you follow in one line.
- A rejection ends that direction. Record it in the topic file's never-re-offer list, and build the next round from what the owner said they wanted, not a variant of what they rejected.
- Details the owner wants to decide themselves stay open: ask them, rather than defaulting to your pick.

## 6. Record the round, then start the next

After each round:

1. Write or update the exploration's topic file in memory (`<subject>-exploration`): the owner's quote, the Artifact link, the options, each round's feedback, the picks, the never-re-offer list, and how the captures were made.
2. Go back to step 1 for the next round on the same Artifact, carrying the picks forward as Today's direction.

Done with a round when memory holds its feedback and picks and the next round is under way. The exploration continues until the owner says it is done. Tickets, triage labels and build threads come only from the owner's own ask, so the tracker stays unchanged throughout.

## When the owner asks for a spec

Only when the owner says to: write one spec from the topic file with the repo's spec skill (such as `to-spec`), linking the Artifact and naming each pick, and show it to the owner before filing. Labels, tickets and dependencies follow the tracker's docs and the owner's answer. Building happens in its own threads and PRs, with the screenshots RULES.md's PR evidence rule asks for.
