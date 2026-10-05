---
name: screenplay-design-audit
description: Audit the app’s screens for design problems and fix the ones the user picks. Use when the user asks to audit, review or critique a screen, flow or the whole app’s design.
---

# Skill: Auditing a design

A **finding** is one problem on one screen. A **call** is a finding only the
user can decide, because it has more than one fair fix. You compose the
audit from your tools: the frame tools to see and drive the running app, a
findings page Mockup (or a Document for a short list), `ask_question` for
the calls, and your Workspace for the fixes.

## 1. Scope

Name the screens in scope from the user’s words: one screen, one flow, or
every route the app has. Collect the user’s design rules from canvas and
account memory and from the repository’s own docs (a design system,
`AGENTS.md`, lint rules), and the findings memory says were already decided
or rejected, so the audit leaves them out.

Done when every screen in scope has a frame you can open and the rules list
names where each rule came from.

## 2. Inspect

For each screen, three lenses:

- **Product**: every claim the screen makes is true, and a real user can
  finish what they came to do. Check claims against the code (`file:line`).
- **Hierarchy**: what a person sees first, what they can reach, where a flow
  dead-ends. Drive it for real (`frame_click`, `frame_type`, `frame_hover`)
  to reach empty, error, loading and open-menu states.
- **Visual**: spacing, type, colour and component drift against the rules,
  measured from the page (`frame_elements`, `read_frame_html`).

Tag each finding with its lens letter and a number (P3, H7, V12).

Done when every screen in scope has been looked at through all three lenses
in every theme the app ships.

## 3. Report

Each finding carries its tag, what’s wrong, where (`file:line`) and the fix;
a visual fix whose look matters also gets Now and After pictures, saved with
`screenshot_page` and `saveAs` or drawn from the screen’s real markup.

- A handful of findings with no calls fits a Document (`create_document`).
- Anything longer goes on one **findings page**: a Mockup titled
  `<scope> · Audit` built from this skill’s `audit-template.html`. It shows
  filter tabs by lens, each finding with its pictures, Fix or Skip, and each
  call’s options. Copy the template whole and fill only its data script; its
  `skill:` lines load the page, and its files comment says how to reference
  the pictures.
- When the calls outgrow one card at a time (several plans, many calls), put
  them on one decisions page from `decisions-template.html` instead.

Ask each call with its own `ask_question`, passing the page’s `mockup_id`:
start the question with the call’s tag (“H2: …”), use the page’s option
labels and mark the one you’d pick recommended, so a pick on the page
answers the card. End your turn.

Done when every finding has a tag and a fix, and every call is asked.

## 4. Fix

Once the user has answered, on the cards or with picks sent from the page,
fix what they picked in your Workspace, smallest and surest first, and check
each fix with `view_frame`. A skipped finding is dropped; a rejected
direction goes to canvas memory (`write_memory`) so no later audit raises it
again. Reply with what changed, by tag, and anything left open.
