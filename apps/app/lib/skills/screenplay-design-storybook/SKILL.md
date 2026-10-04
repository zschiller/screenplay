---
name: screenplay-design-storybook
description: Lay out one part of the UI as a Mockup with a knob for each of its states, so the user can step through them. Use when the user asks to storybook, showcase or show every state of a component, panel or screen.
---

# Skill: A storybook of states

A **storybook** shows one **part** (a component, a row, a panel, a dialog, a
screen) in every **state** it can be in, as one Mockup on the canvas. Each
**control** is one dimension that changes how the part looks (status,
content length, open or closed, width, theme), and each becomes a knob. The
user steps through the states from the Knobs button and points at anything
they want changed.

## 1. Map the states

Read the part’s code: its props, the data it reads, every conditional in its
render, and its call sites. Each distinct render branch is a state. Add the
states its data reaches (empty, one, many, long text, loading, error,
disabled), the interaction states a person sees (hover, focus, open menus),
every width it lives at, and every theme the app ships. Group them into
controls with short lists of values (Status: Idle, Running, Failed). A
combination nobody can reach in the app stays out.

Done when every render branch maps to a control value or to a stated reason
it’s left out, citing `file:line`.

## 2. Build the Mockup

1. Start from the real markup: open a frame showing the part and read it
   (`read_frame_html`), so the Mockup uses the app’s own classes, tokens and
   fonts. Inline the styles the part needs.
2. Render every state from one function of the knob values, so switching a
   knob redraws the part in place and nothing around it jumps.
3. Declare one knob per control with `screenplay.registerKnob` (see the
   screenplay-add-knob skill): `tabs` for two or three short values, `select`
   for more, `boolean` for on or off (hover, open), `slider` for width, and a
   Theme knob when the app ships more than one. Give each a `description`
   when its label alone doesn’t say what it changes, and `group` related
   knobs. Defaults show the most common state.
4. Beside the part, show the chosen state’s name and one line on what’s worth
   looking at in it, citing the code that produces it, and a list of every
   named state with the knob values that reach it. Whatever makes each
   state easiest to judge belongs on the page.
5. Title it `<part> · Storybook` and create it with `create_mockup`.

Done when every control is a knob and every value of every knob renders.

## 3. Check and share

Step through every knob value yourself with `view_frame`, in every theme:
the part sits at the same size and place in each state, nothing is clipped,
and each state matches what the app does. A defect the app itself has stays
in the Mockup, and your reply names it. Reply with how many controls and
states the storybook holds and anything you noticed.

When the user points at an element or names a state, take each note as work
on that state: a fix to the part goes in your Workspace; a question with
more than one fair answer becomes an exploration (screenplay-explore-with-mockups)
when they want options.
