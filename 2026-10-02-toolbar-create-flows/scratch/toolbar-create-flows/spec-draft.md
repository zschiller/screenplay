# Draw a Frame or Mockup, then ask (spec draft)

Exploration: https://claude.ai/artifact/RABKu137oxvoCtuJWCKmRk. The picks were round 1 B+D, round 2 D, the chip rule, and round 3 A.

## Problem Statement

The Frame tool draws an empty box that can only show a Workspace that already exists. If none fits, the box is a dead end, and to get new work started you leave the canvas and go to chat. Mockups aren't on the toolbar at all. Only a chat can make one, in a size and place it chooses. So the toolbar can't do the thing a box is best at, which is saying "make something this big, here".

## Solution

Drawing a box with Frame (F) or the new Mockup tool (M) opens an ask card the moment you let go. The card is the chat composer on the floating surface. It is centred on the box in screen space at UI scale, so it reads the same at any zoom. A chip on the card says who answers. That is the Workspace chat of the selected layer, or a new chat when nothing is selected, and the chip can switch between them. Sending makes the answer fill the box, and the box's size is the viewport.

Esc or clicking away closes the card. An unanswered Mockup box is removed. An unanswered Frame stays and shows today's No Workspace screen with a new Start a chat button that reopens the card. Picking an existing Workspace stays in the frame title's Choose a workspace dropdown. Document and Comment don't change.

## User Stories

1. As a canvas user, I want to draw a frame and say what it should be, so that new work starts where I drew it without leaving the canvas.
2. As a canvas user, I want the box I draw to set the viewport, so that a phone-sized box gets a mobile take.
3. As a canvas user, I want the ask card to appear as soon as I let go, so that drawing and asking feel like one gesture.
4. As a canvas user zoomed out to 25%, I want the card at full UI size, so that I can read and type in it at any zoom.
5. As a canvas user, I want the card centred on the box I drew, so that my eye stays where I was working.
6. As a chat user, I want the card to look and behave like the chat composer (field, chip, Send, Enter to send, Shift+Enter for a new line), so that there's nothing new to learn.
7. As a canvas user, I want a chip that shows who will answer, so that I know whether I'm starting new work or asking existing work.
8. As a canvas user with a layer selected, I want the chip to default to that layer's Workspace chat, so that a second view or a sketch goes to the work I'm looking at.
9. As a canvas user with nothing selected, I want the chip to default to New chat, so that drawing on empty canvas starts fresh work.
10. As a canvas user, I want to switch the chip to New chat or another Workspace, so that I can override the default.
11. As a canvas user, I want a Frame answered by an existing Workspace to show that Workspace, so that the frame isn't left empty while its chat works.
12. As a canvas user, I want a Frame answered by a new chat to show the new Workspace as it boots, so that I see progress in the box I drew.
13. As a canvas user, I want Esc or clicking away to close the card without sending, so that I can back out.
14. As a canvas user, I want a Frame I didn't answer to stay on the canvas, so that I can come back to it.
15. As a canvas user, I want an unanswered Frame to offer Start a chat, so that I can reopen the ask later.
16. As a canvas user, I want the unanswered Frame to keep pointing me to the title's Choose a workspace dropdown, so that I can show existing work without typing.
17. As a canvas user, I want a Mockup tool on the toolbar with the M shortcut, so that I can sketch a static page into a box.
18. As a canvas user, I want an unanswered Mockup box to disappear, so that empty boxes don't pile up.
19. As a canvas user, I want a sent Mockup box to show that a chat is sketching (the 9-dot), so that I know model work is under way.
20. As a canvas user, I want the finished Mockup to land in the box I drew, at its size, so that placement is mine and not the Coordinator's.
21. As a Workspace chat, I want the drawn Mockup to already be mine, so that I fill it with the update tool I already have.
22. As a collaborator, I want the box someone drew to appear for me only once it's a Frame or a sent Mockup, so that I don't see their half-made drafts.
23. As a collaborator, I want the ask card to be private to the person who drew the box, so that two people never type into the same card.
24. As a keyboard user, I want the card focused when it opens, so that I can type right away.
25. As a keyboard user, I want the ? shortcut sheet to list M, so that I can find the Mockup tool.
26. As a reader of the docs, I want the canvas, frames and mockups guides to describe the new flow, so that the docs match the app.

## Implementation Decisions

- **Mockup tool.** Tool mode gains `mockup`, bound to M in the shared shortcut table, so the ? sheet picks it up. The toolbar gets a Mockup button between Frame and Document, using the palette icon the sidebar uses for Mockups, and the empty-canvas hint mentions it.
- **When boxes are created.** A Frame box is created when you let go, as today (a blank frame in its own Group). A Mockup box stays a local draft until you send, so Esc or clicking away has nothing to delete. A click without a drag uses each kind's default size.
- **Ask card.** A new canvas component renders the existing Composer inside the shared floating surface (FloatingToolbar's surface: background, shadow-md, faint outline). It goes through the same screen-space portal as the frame bar and is centred on the box's screen rect. The chip sits where the composer's model pill is, and the model uses the default. The card is per-viewer UI state and is never written to the room doc. It opens focused. Enter sends, and Esc or a pointer-down outside closes it.
- **Who answers.** One pure function decides the default from the canvas selection. A frame resolves to its Workspace's chat, through `workspaceChatId`. A Mockup or Document resolves to its owner chat's Workspace chat. Anything else, or no selection, resolves to New chat. The chip menu reuses the existing Workspace list, with New chat added as the first row.
- **Sending a Frame.**
  - To an existing Workspace: assign the frame to that Workspace's Branch, then send the prompt to its Workspace chat through the existing prompt dispatch.
  - To a new chat: create the Branch with the same defaults and naming as the New Workspace dialog (ADR 0004). Assign the drawn frame to it instead of seeding new frames, then queue the prompt to fire when the Workspace is running, as the dialog does. Branch creation gains a way to skip its own frame seeding when the caller supplies a frame.
- **Sending a Mockup.** Create a Mockup layer at the drawn box and size, with `ownerChatId` set to the answering chat and an empty page. An empty page renders as the sketching state (9-dot). The prompt names the Mockup and its viewport, so the chat fills it with `update_mockup`, which it already owns, and `create_mockup` doesn't change. With New chat, the Branch and chat are created first, so the owner chat id is known.
- **The prompt carries the viewport.** The sent message includes the box size, for example "for a 390 × 844 viewport". For a Mockup it also carries a reference to the target Mockup, in the same `[…]` marker style that element tokens use.
- **Unanswered Frame.** The No Workspace stage gets a Start a chat button (stock outline Button in EmptyContent) and the new description "Start a chat to build something here, or choose a Workspace from the frame's title." The Empty container keeps pointer-events-none, apart from the button. Start a chat selects the frame and reopens the ask card on it.
- **No placement override needed.** A box you drew keeps its place. The Coordinator never moves an existing layer, so nothing in layout changes.

## Testing Decisions

- Good tests check what the user sees or what lands in the room doc, not hook internals.
- **Seam 1, canvas ops (main seam).** Use the `makeHarness()` style from the ops tests:
  - a Frame sent to an existing Workspace ends assigned to it;
  - a Frame sent to New chat ends assigned to a new Branch, and no extra frames are seeded;
  - a sent Mockup is a Mockup layer at the drawn rect, owned by the answering chat, with an empty page.
- **Seam 2, the who-answers function.** Pure unit tests over selections: a frame, a Mockup, a Document, several layers, none.
- **Seam 3, the draw hook.** Follow the existing `use-draw-tool` hook test style (jsdom, renderHook):
  - letting go with Frame or Mockup opens the ask for that rect;
  - Esc on a Mockup leaves no layer behind;
  - the tool returns to Select.
- **Agent side.** Extend the existing mockup-tools harness test: `update_mockup` fills a Mockup made empty by a person on that chat's behalf.
- **Visual.** Add docs screenshots in `apps/app/screenshots/docs/` for the ask card and the unanswered frame. The PR shows before/after shots in light and dark.

## Out of Scope

- Document and Comment tools.
- An in-frame Workspace picker (rejected in #798 and PR #844). Existing Workspaces stay in the title dropdown.
- A single prompt tool routed by the Coordinator, and dropping the Frame tool (both rejected in round 1).
- Choosing the model or repo on the card (the defaults from the New Workspace dialog apply).
- Shared live ask cards between collaborators.

## Further Notes

- On a Canvas with several repos, New chat uses the repo the New Workspace dialog would preselect.
- A Mockup from a new chat still boots a whole Workspace, per one chat per Workspace (#1315).

---

# Proposed tickets (for /to-tickets after the spec is filed)

1. **Frame asks when drawn (New chat).** Blocked by: none. Drawing a Frame opens the ask card, built from the mini composer and centred on the box at UI scale. Sending starts a new Workspace in that frame, with the viewport in the prompt. Esc or clicking away leaves the No Workspace frame. Updates the frames guide.
2. **The chip picks who answers.** Blocked by: 1. The selected layer's Workspace chat is the default, otherwise New chat, and the chip menu can switch it. A Frame sent to an existing Workspace shows that Workspace.
3. **Start a chat on an unanswered frame.** Blocked by: 1. The No Workspace stage gains a Start a chat button, which reopens the card, and its description changes to match.
4. **Mockup tool (M).** Blocked by: 2. Adds a toolbar button and the M shortcut. Drawing opens the same card. Sending creates a Mockup owned by the answering chat at the box, shows the 9-dot while it's empty, and the chat fills it with update_mockup. An unanswered box is removed. Updates the canvas and mockups guides.
