---
name: screenplay-design-exploration
description: Explore a design question with lettered takes as Mockups on the canvas, over as many rounds as the user wants, then build the one they pick. Use when the user asks to explore, mock up or compare designs for a screen, flow or component, or to build one of your takes (“build take B”).
---

# Skill: Exploring with Mockups, then building one

An **exploration** answers one design question with **takes**: distinct,
lettered answers (A, B, C) beside the real screen. A **round** is one set of
takes; the user’s pick starts the next. You compose it from your tools:
`view_frame`, `read_frame_html` and `screenshot_page` to see the app as it
is, `create_mockup` and `update_mockup` for the takes, `ask_question` for
the pick, and your Workspace for the build.

## Exploring

1. **Frame the question.** State it in one line, in the user’s words. Every
   take answers that question and no other, and traces to what the user
   said or to a fact in the code.
2. **Look at today.** When the ask is about a screen that exists, read its
   frame and the code behind it, and note the numbers that matter: sizes,
   colours, which component. Canvas and account memory hold the user’s
   design rules and rejected directions: drop any take one of them already
   settles.
3. **Pick the form**, whichever makes the decision clearest:
   - **One Mockup per take**, titled `<subject> · <letter> · <name>`, e.g.
     “Empty cart · B · Inline tips”, when each take is judged by looking at
     it or using it.
   - **An exploration page**: one Mockup titled `<subject> · Exploration`
     built from this skill’s `exploration-template.html`, when comparing is
     the point, the round asks several small questions, or the question is
     structural. It holds Today and one tab per round, each question’s takes
     behind A / B / C with their pictures, why, cost and the recommendation.
     Copy the template whole and fill only its data script; its `skill:`
     lines load the page. Save captures with `screenshot_page` and `saveAs`,
     and reference them as its files comment says.
4. **Draw the takes**, two to four per question. Takes are **distinct**: a
   different answer, not a spacing tweak of another take. Draw them in the
   app’s real markup, components and tokens; a take that needs a new
   component says so. A structural question (where something lives, what a
   flow’s first step is) gets plain grey boxes with real labels; a visual
   one (type, colour, spacing) gets the real screen restyled. A take judged
   by using it gets working tabs, toggles or steps, knobs for values worth
   tweaking live (screenplay-add-knob), and shared state for what everyone
   viewing should see the same (screenplay-share-state).
5. **Check each take** with `view_frame` as the user will see it, in every
   theme the app ships: alignment, spacing, contrast, nothing clipped. Fix
   what’s off before asking.
6. **Ask for the pick** with one `ask_question` per open question, passing
   the Mockup’s `mockup_id`: an option per take labelled by its letter and
   name (“B · Inline tips”), the one you’d pick marked recommended. A
   question with one take is a sign-off, asked as Looks good or Needs
   changes. Labelled this way, a pick on the page answers the card. End your
   turn.

Done with a round when every take has been viewed in every theme and every
open question has its card.

## Rounds

- A pick settles that question and becomes the starting point of the next
  round: explore what it leaves open, or the next question the user raises.
  Say in one line which take you follow.
- A change to a take rewrites its Mockup with `update_mockup`. A new round
  keeps the earlier ones to compare: new Mockups per take, or on an
  exploration page a new round at the front of its rounds with the earlier
  takes marked picked or rejected.
- A take the user rejects ends that direction: save it to canvas memory
  (`write_memory`) so no later chat offers it again, and build the next round
  from what they said they wanted.
- A message drafted on one of your Mockups (a `Drafted on mockup` footer) or
  targeting an element in one (`mockup <id>` in its Targeted elements
  footer) is about that page: read it with `read_mockup` and rewrite it with
  `update_mockup`.

The exploration runs until the user ends it or asks you to build a take.

## Building one

When the user asks you to build a take (“build take B”, “go with the
toggle”):

1. **Find it.** Match their words to one of your takes; `read_mockup` with
   no id lists your Mockups with ids and titles. When more than one fits,
   ask with `ask_question`.
2. **Read its page** with `read_mockup` for the current HTML, since a later
   round may have rewritten it.
3. **Write the decisions summary**: a few lines naming the take and what was
   settled along the way, such as answers to question cards, changes asked
   for in chat, and takes passed on and why. It goes in your final reply, so
   the user can correct anything you read wrong.
4. **Build it in your Workspace** in the app’s own components, tokens and
   conventions. The take is the target picture; the code is the app’s own.
5. **Check it.** `view_frame` your frame beside the take and fix what
   differs. Leave the Mockup on the canvas.

Then reply: what you built, from which take, the decisions summary, and
anything from the take you left out and why.
