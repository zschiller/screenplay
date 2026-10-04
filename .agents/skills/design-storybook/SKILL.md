---
name: design-storybook
description: Design storybook puts one part of the UI on a page with controls for its states, so the owner can step through them and leave a note on any state. Use when asked to storybook, showcase or lay out a component, panel or screen's states for feedback.
---

# Design storybook

A **storybook** shows one **part** of the product (a component, a panel, a row, a dialog, a whole screen) on one published Artifact, in every **state** it can be in. **Controls** pick the state: one control per dimension that changes how the part looks (status, content length, open or closed, hover, width, theme). The owner steps through the states and leaves a **note** on any of them; the page copies the notes for the owner to paste back.

A storybook is the third design skill beside [`design-audit`](../design-audit/SKILL.md) (many problems across a surface) and [`design-exploration`](../design-exploration/SKILL.md) (lettered options answering one question). A storybook asks no question and offers no options: it shows the part as it is, or as a branch in flight has it, so the owner can react state by state.

## 1. Map the states

1. Quote the owner's words, and name the part and the branch it's shown from (main, or the PR in flight).
2. Read the part's code: its props, the data and stores it reads, every conditional in its render, and its call sites. Each distinct render branch is a state. Add the states the code reaches through its data: empty, one, many, long text, missing image, loading, error, disabled, no permission. Add the interaction states a person sees: hover, focus, pressed, open menus and tooltips. Add every width the part lives at, and every theme the product ships.
3. Group the states into controls. A control is one dimension with a short list of **values** (Status: Idle, Running, Failed). The **matrix** is every combination of values; most parts need only a few dozen of its cells, so choose the cells that show something new and list them as named states. A combination nobody can reach in the product stays out.
4. Gather the owner's design rules as [`../design-exploration/RULES.md`](../design-exploration/RULES.md) describes, so the critique in step 4 has something to check against.

Done when every render branch in the part's code maps to a state or to a stated reason it's left out, citing `file:line`.

## 2. Pick the fidelity

- **Captured** (the default): every state is a capture of the real part, in every theme. Use it for anything that reads app context (stores, routing, sessions, live data), and for interaction states.
- **Live**: the real part bundled into the page, re-rendered as the controls change, so in-between values and typing work. Use it only when the part renders from props alone and its styles compile to one stylesheet; bundle with the repo's own tooling (or esbuild) into one script that defines `RENDER` for the template, plus the compiled CSS.

Pick live when the controls include free values (any text, any number) that captures can't cover. Otherwise capture.

## 3. Capture every state

Mount the part on a **stage**: a scratch route, story or fixture screen that renders only the part, inside the app's providers, theme and fonts, at a fixed width with padding around it, with its props and seeded data read from URL params. Use the repo's Storybook or screenshot harness when it has one; otherwise follow [`../design-exploration/CAPTURE.md`](../design-exploration/CAPTURE.md). The stage lives only in the repo's gitignored scratch area or the scratchpad, so the branch carries none of it.

1. Drive interaction states with real input (hover, focus, click to open) before each capture, and wait for transitions to settle.
2. Crop every capture to the stage, so each state shows the part at the same size and position and switching states doesn't jump. Shoot at device scale 2.
3. A part that only makes sense in place (a toolbar, a whole panel) can be captured in the product itself, with its state set through fixtures, as long as every state frames the same region.

Done when every listed state has a capture in every theme, all cropped to one size.

## 4. Build the page

One Artifact per part, built from [`storybook-template.html`](storybook-template.html). Load `artifact-design` first. The template is a built page: read and edit only the part above its `Generated below this line` marker, where you fill in the `PAGE`, `CONTROLS` and `STATES` data (and load the `RENDER` script for live) and swap the token block (shadcn variable names) and font link for the repo's brand. When the repo holds the template's source (the package that builds it), change the page there and rebuild instead. The template does the rest: a segmented control per dimension, the stage showing the chosen state in the viewer's theme with a Light/Dark switch, an All states grid that marks states with notes, a note field per state, and a bottom bar that copies every note at once.

- Give each state a short name a person would say ("Running, long title") and, when it shows something worth looking at, one line on what (`why`), citing the code that produces it.
- A control value with no state next to the current ones is dimmed and jumps to the closest state that has it, so the matrix can stay sparse.
- When the owner asks for another round, update the same Artifact so the link never changes: bump `PAGE.round`, and put the owner's earlier note and what changed on the state as `said`.

Open every capture at full size in every theme before publishing, the way the owner will see it, and run `node --check` on the filled data script once. A defect visible in a capture goes in that state's `why`, so the owner sees it already noticed.

## 5. Share it and take the notes

Reply with the link and one line on what's in it: how many states, and anything already noticed. The owner steps through the states and pastes back the copied notes.

When the notes arrive, record them in memory in the storybook's topic file (`<part>-storybook`): the Artifact link, the round, each note with its state. A note on a part in flight goes into that branch's work. A note that asks a design question with more than one answer becomes a `design-exploration` when the owner wants options. Any other note waits for the owner to say what to do with it.

Done when every note is recorded against its state and each has a next step or is waiting on the owner.
