# App audit 2026-10-03: PR briefs

Plan: https://claude.ai/artifact/G2S1EKquNwV4XzMcKJmg8o · Audit (finding detail, captures, file:line): https://claude.ai/artifact/N39qw6mf6AHQRrAxL3K4eG
Zack's picks: thread "Design audit", message cmsg_012JFc5sy26QDYH92RZinL5EENSPrCvtqhG1WC5jWKSEzN; "Start all" tapped 15:32Z.
Every PR: zschiller/screenplay, targeted before/after screenshots light+dark (claude/pr-screenshots branch), Docs line or docs update, full app suite before push.

1. Visual nits (built): N1, N2, N3 A (Signal inks), N4 A (hover-only caret; status must give up width before the name so narrow labels don't jump), N6, N7, N8, N9. Start from /mnt/project-files/design-audit-2026-10-03/prototype.patch (applies to 05fc1cd).
2. Copy + docs sweep: P11 B tool rows say "Used <page>" and add Drove/Driving to lib/ui-copy/rules.ts; P3 hosted Remove confirm says removed for everyone with the canvas's edits, + "Ana added it." when someone else added it; P12 desktop sentence in Settings repo dialog; P13 stray "sandbox" strings; P14 docs drift (Delete chat, Open frame, "Turning off"); P15 Remove dialog says chats.
3. Needs-you for questions: P2 questionPending beside planPending ("Question waiting") + docs lists; P9 A needs-you dot after the Coordinator crumb.
4. Keyboard: H1 inert on collapsed sidebar/chat panels; H9 one Tab stop per sidebar row, F2 renames.
5. Desktop repos Add/Remove: H3 A desktop Canvas settings uses hosted's Add/Remove buttons, no switches; P4 A Remove confirms when customized ("Its changes on this canvas are lost."); P10 A hosted hides a repository a teammate already added.
6. One repository look (after PR 5, same dialog): H5 owner/name in both lists, "Manage in Settings" link under the Canvas list, "On N canvases" on Settings rows; N5 A both edit dialogs use Settings' chrome (hairline header, sticky footer) and say "Save".
7. Mockup ⋯: H2 A mockup bar gets the frame bar's trailing ⋯: Duplicate, status choices, Delete. No right-click menus.
8. Workspace header ⋯: H4 A ⋯ after the workspace name in the chat header with BranchOverflowMenuContent, matching the canvas-name ⋯ (canvas-top-bar.tsx:166-176); frame's Workspace submenu reuses it. No Chats button in workspace headers.
9. Orphaned mockups/docs: P8 A after its chat is deleted any chat can edit; the first chat that edits claims it (ownerChatId moves, lib/canvas/document-owner.ts); "Ask the agent to add a knob" returns.
10. (WAITS on live frames rethink R3) P7 B: control passes to the asker after a request waits N idle minutes; visible asked state; "not now" toast.
Exploration (design-exploration skill, no tickets): H7 where New chat lives in the Chats menu (fixed header row vs + on first section vs bottom row). Zack: "design explore first".
