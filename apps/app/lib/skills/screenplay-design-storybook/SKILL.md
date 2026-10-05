---
name: screenplay-design-storybook
description: Lay out one part of the UI as a Mockup with controls for its states, so the user can step through them and leave a note on any state. Use when the user asks to storybook, showcase or show every state of a component, panel or screen.
---

# Skill: A storybook of states

A **storybook** shows one **part** (a component, a row, a panel, a dialog, a
screen) in every **state** it can be in, as one Mockup on the canvas. Each
**control** is one dimension that changes how the part looks (status,
content length, open or closed, width), with a short list of values. The
user steps through the states, leaves a note on any of them, and sends the
notes to the chat from the page.

## 1. Map the states

Read the part’s code: its props, the data it reads, every conditional in its
render, and its call sites. Each distinct render branch is a state. Add the
states its data reaches (empty, one, many, long text, loading, error,
disabled), the interaction states a person sees (hover, focus, open menus),
and every width it lives at. Group them into controls (Status: Idle,
Running, Failed), the first value the most common. A combination nobody can
reach in the app stays out.

Done when every render branch maps to a control value or to a stated reason
it’s left out, citing `file:line`.

## 2. Build the page

Build it from this skill’s `storybook-template.html`: copy the template
whole and fill only its data script; its `skill:` lines load the page, which
draws the controls, a note per state, an All states grid, and Send to chat.

1. List the controls, and the states worth showing as named cells of the
   controls (“Running, long title”), each with one line on what’s worth
   looking at in it (`why`), citing the code that produces it.
2. Draw every state from the real part:
   - **Live** (the default): read the part’s markup from a frame
     (`read_frame_html`) and, in an inline script above the data script,
     set `window.RENDER` to one function of the control values that draws
     the part with the app’s own classes and the styles it needs, so every
     combination renders and the part never jumps.
   - **Captured**, for a part that only makes sense in place (a whole panel,
     a screen): save one picture per state and theme with `screenshot_page`
     and `saveAs`, all framing the same region, and reference them as the
     template’s files comment says.
3. Title it `<part> · Storybook` and create it with `create_mockup`.

Done when every listed state renders in every theme the app ships.

## 3. Check and share

Step through every state yourself with `view_frame`, in every theme: the
part sits at the same size and place in each, nothing is clipped, and each
state matches what the app does. A defect the app itself has stays in the
storybook, noted in that state’s `why`. Reply with how many controls and
states the storybook holds and anything you noticed.

Notes arrive as a message drafted on the page or as a targeted element.
Each is work on its state: a fix to the part goes in your Workspace; a
question with more than one fair answer becomes an exploration
(screenplay-design-exploration) when the user wants options.
