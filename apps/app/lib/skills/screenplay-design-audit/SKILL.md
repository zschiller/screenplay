---
name: screenplay-design-audit
description: Audit the app’s screens for design problems and fix the ones the user picks. Use when the user asks to audit, review or critique a screen, flow or the whole app’s design.
---

# Skill: Auditing a design

A **finding** is one problem on one screen. A **call** is a finding only the
user can decide, because it has more than one fair fix. You compose the
audit from your tools: the frame tools to see and drive the running app, a
Document for the findings, Mockups for fixes worth seeing, `ask_question`
for the calls, and your Workspace for the fixes.

## 1. Scope

Name the screens in scope from the user’s words: one screen, one flow, or
every route the app has. Collect the user’s design rules from canvas and
account memory and from the repository’s own docs (a design system,
`AGENTS.md`, lint rules). Leave out anything memory says was already decided
or rejected.

Done when every screen in scope has a frame you can open and the rules list
names where each rule came from.

## 2. Inspect

For each screen, three lenses:

- **Product**: every claim the screen makes is true, and a real user can
  finish what they came to do. Check claims against the code (`file:line`).
- **Hierarchy**: what a person sees first, what they can reach, where a flow
  dead-ends. Drive it for real (`frame_click`, `frame_type`, `frame_hover`)
  to reach empty, error, loading and open-menu states.
- **Visual**: spacing, type, colour and component drift against the rules.
  Measure from the page (`frame_elements`, `read_frame_html`) rather than
  eyeballing a screenshot.

Tag each finding with its lens letter and a number (P3, H7, V12).

Done when every screen in scope has been looked at through all three lenses
in every theme the app ships.

## 3. Report

Put the findings where they are easiest to decide on. A short list fits a
Document (`create_document`). A longer audit reads better as one **findings
page** Mockup titled `<scope> · Audit`: filter tabs by lens, and per finding
its tag, what’s wrong, where (`file:line`), the fix, and Now and After
pictures drawn from the screen’s real markup, with the calls marked. Either
way, each finding carries its tag, what’s wrong, where and the fix. A visual
fix whose look matters gets its After picture, on the page or as its own
Mockup titled `<tag> · After`. Then ask each call with
its own `ask_question`: an option per fix, the one you’d pick marked
recommended. When the call is on a findings page, pass the page’s
`mockup_id`, start the question with the call’s tag (“H2: …”) and use the
page’s option labels, so a pick on the page answers the card. End your turn.

Done when every finding has a tag and a fix, and every call is asked.

## 4. Fix

Once the user has answered, fix what they picked in your Workspace, smallest
and surest first, and check each fix with `view_frame`. A skipped finding is
dropped; a rejected direction goes to canvas memory (`write_memory`) so no
later audit raises it again. Reply with what changed, by tag, and anything
left open.
