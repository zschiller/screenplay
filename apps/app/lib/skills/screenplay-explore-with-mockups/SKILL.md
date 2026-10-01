---
name: screenplay-explore-with-mockups
description: Explore a design as Mockups on the canvas, then build the one the user picks. Use when the user asks to explore, sketch, mock up or compare takes on a screen, flow or component, or asks to build one of your Mockups ("build take 2").
---

# Skill: Exploring with Mockups, then building one

There's no special workflow for this. You compose it from your tools:
`create_mockup` and `update_mockup` for the takes, `view_frame` and
`read_frame_html` to start from what the app really looks like,
`ask_question` for forks, and your Workspace for the build. How many takes,
how they're grouped, how many rounds and where they sit are your call; the
canvas places each new Mockup beside your others.

## Exploring

- **Start from the app when it helps.** When the ask is about a screen that
  exists, read its frame first (`read_frame_html`, or `view_frame` for a
  look), so the takes are drawn in the app's real markup and styles rather
  than from memory.
- **One Mockup per take.** Each take is a self-contained page, titled so it
  reads in a frame label, e.g. "Empty cart · Illustration". Make the takes
  clearly different directions, not small tweaks of one idea.
- **Revise in place.** A change to a take rewrites that Mockup with
  `update_mockup`; a new direction is a new Mockup.
- **Ask forks as question cards.** When the next step hangs on a choice only
  the user can make, ask it with `ask_question` and end your turn. Questions
  you can settle yourself, settle.
- **Statuses are notes for the people following along.** Every Mockup starts
  Current. Use `update_mockup`'s `status` however helps them track the takes,
  e.g. Set aside for takes they passed on. They can change it too.

## Building one

When the user asks you to build a take ("build take 2", "go with the
toggle"):

1. **Find it.** Match their words to one of your Mockups; `read_mockup`
   with no id lists yours with ids, titles and statuses. If it's ambiguous,
   ask with `ask_question`.
2. **Read its page.** Call `read_mockup` with its id for the current HTML,
   rather than recalling it, since a later round may have rewritten it.
3. **Write the decisions summary.** A few lines naming what was picked and
   settled along the way: the take, answers to question cards, changes asked
   for in chat, takes set aside and why. It goes in your final reply, so the
   user can correct anything you read wrong.
4. **Build it in your Workspace.** Change the app's real code to match the
   Mockup, following the summary, using the app's own components, tokens and
   conventions. The Mockup is the target picture, not code to paste.
5. **Check it.** `view_frame` your frame and compare it with the Mockup;
   fix what differs.
6. **Mark it Built.** Set that Mockup's status to `built` with
   `update_mockup`. Leave the Mockup on the canvas.

Then reply: what you built, from which take, the decisions summary, and
anything from the Mockup you left out and why.
