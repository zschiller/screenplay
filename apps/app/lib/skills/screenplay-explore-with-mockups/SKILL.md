---
name: screenplay-explore-with-mockups
description: Explore a design question with lettered takes as Mockups on the canvas, over as many rounds as the user wants, then build the one they pick. Use when the user asks to explore, mock up or compare designs for a screen, flow or component, or to build one of your Mockups (“build take B”).
---

# Skill: Exploring with Mockups, then building one

An **exploration** answers one design question with **takes**: distinct,
lettered answers (A, B, C), each its own Mockup on the canvas beside the
real screen. A **round** is one set of takes; the user’s pick starts the
next. You compose it from your tools: `view_frame`, `read_frame_html` and
`frame_screenshot` to see the app as it is, `create_mockup` and
`update_mockup` for the takes, `ask_question` for the pick, and your
Workspace for the build.

## Exploring

1. **Frame the question.** State it in one line, in the user’s words. Every
   take answers that question and no other, and traces to what the user
   said or to a fact in the code.
2. **Look at today.** When the ask is about a screen that exists, read its
   frame (`read_frame_html`, `view_frame`) and the code behind it, so the
   takes are drawn in the app’s real markup, tokens and component styles
   rather than from memory. Note the numbers that matter: sizes, colours,
   which component. Canvas and account memory hold the user’s design rules
   and rejected directions: drop any take one of them already settles.
3. **Draw the takes.** Two to four Mockups, one per take, titled
   `<subject> · <letter> · <name>`, e.g. “Empty cart · B · Inline tips”.
   Takes are **distinct**: a different answer, not a spacing tweak of
   another take. Stay inside the app’s own components and tokens; a take
   that needs a new component says so. People can Interact with a Mockup,
   so give a take working tabs, toggles or steps when that’s how to judge
   it, knobs (`screenplay.registerKnob`) for values worth tweaking live,
   and `screenplay.shareState` for state everyone viewing should see the
   same (see the screenplay-add-knob and screenplay-share-state skills).
   A question about structure (where something lives, what a flow’s first
   step is) is drawn as plain grey boxes with real labels; a visual question
   (type, colour, spacing) as the real screen restyled.
   When the takes are easier to judge together, with their reasoning beside
   them (a structural question, several small questions in one round, a
   comparison of flows), make one **decision page** Mockup instead, titled
   `<subject> · Round <n>`: the question, what today does, then each take
   behind A / B / C tabs with its picture, why, what it costs, and the
   recommendation marked. Use whichever makes the decision clearest.
4. **Check each take** with `view_frame` as the user will see it, in every
   theme the app ships: alignment, spacing, contrast, nothing clipped. Fix
   what’s off before asking.
5. **Ask for the pick** with one `ask_question` per open question: an option
   per take, labelled by its letter and name, and the one you’d pick marked
   recommended. End your turn.

Done with a round when every take has been viewed and the pick is asked.

## Rounds

- A pick settles that question and becomes the starting point of the next
  round: explore what it leaves open, or the next question the user raises.
  Say in one line which take you follow.
- A change to a take rewrites that Mockup with `update_mockup`; a new
  round’s takes are new Mockups, so earlier rounds stay on the canvas to
  compare.
- A take the user rejects ends that direction: save it to canvas memory
  (`write_memory`) so no later chat offers it again, and build the next round
  from what they said they wanted.
- When a message targets an element in one of your Mockups (`mockup <id>`
  in its Targeted elements footer), read that page with `read_mockup` and
  rewrite it with `update_mockup`.

The exploration runs until the user ends it or asks you to build a take.

## Building one

When the user asks you to build a take (“build take B”, “go with the
toggle”):

1. **Find it.** Match their words to one of your Mockups; `read_mockup`
   with no id lists yours with ids and titles. When more than one fits,
   ask with `ask_question`.
2. **Read its page.** Call `read_mockup` with its id for the current HTML,
   rather than from memory, since a later round may have rewritten it.
3. **Write the decisions summary.** A few lines naming what was picked and
   settled along the way: the take, answers to question cards, changes asked
   for in chat, takes passed on and why. It goes in your final reply, so the
   user can correct anything you read wrong.
4. **Build it in your Workspace.** Change the app’s real code to match the
   Mockup, following the summary, using the app’s own components, tokens and
   conventions. The Mockup is the target picture; the code is the app’s own.
5. **Check it.** `view_frame` your frame and compare it with the Mockup;
   fix what differs. Leave the Mockup on the canvas.

Then reply: what you built, from which take, the decisions summary, and
anything from the Mockup you left out and why.
