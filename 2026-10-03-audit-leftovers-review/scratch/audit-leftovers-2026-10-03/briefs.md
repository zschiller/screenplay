# Audit leftovers: briefs (Zack: build all ten, 2026-10-03)

Review page with Zack's picks: https://claude.ai/artifact/6fomiir18mRangDzePP4tb

---

## D1 Desktop / web app badges

Docs plan PR 6 ([plan](https://claude.ai/artifact/PKkCXXHFxtXowkcPLGYAZ8), section "One marker for web-app and desktop features"; decision D4: say "web app").

Pages mark build-specific features in about 11 spellings, some inside headings where they break anchors (e.g. `settings.mdx` "## GitHub *(desktop)*", `workspaces.mdx` "(desktop)" in a heading, `keyboard-shortcuts.mdx` "*(hosted)*"). "Hosted app" still names a product nobody signs up for.

- **H7:** one `<Only desktop />` / web-app component rendering the stock outline `Badge`, on the line under a heading or at the start of a table cell, never in the heading. Anchors become `#github`, `#coding-agents`.
- **P7:** "the web app" instead of "the hosted app", introduced once as "the web app, which you deploy yourself". The badge reads **Web app**. Self-hosting keeps its name.

The hierarchy audit's prototype (`components/only.tsx`) is in /mnt/project-files/docs-audit-hierarchy/prototype.patch.


---

## D2 Docs screenshots at real size

Docs plan PR 7 ([plan](https://claude.ai/artifact/PKkCXXHFxtXowkcPLGYAZ8), section "Screenshots at life size, each with one job"; decision D5: full-window shots only on the Introduction and Core concepts).

Full-window shots show UI text near 6px, details are magnified up to 1.6× (`apps/app/screenshots/docs/frame.ts`, `deviceScaleFactor: 1.5`, `MIN_DETAIL` 560×360), crops slice neighbouring UI, and the hero repeats.

- **H3 + V2:** cap `framePage` magnification at 1×; size each crop to its focus plus padding instead of the 560×360 minimum; crop dialogs to the dialog; blur focused fields before capture.
- **H3:** full-window shots stay only on the Introduction and Core concepts; elsewhere crop to the region the section talks about.
- **H4 + P6:** no repeated hero; Quickstart's last step gets a result shot and the Coordinator with a task card (new docs screen); related pairs sit side by side and stack on phones.

The docs-screenshots workflow recaptures everything after merge; the PR carries targeted before/after shots.


---

## D3 Environment variables page

Docs plan PR 8 ([plan](https://claude.ai/artifact/PKkCXXHFxtXowkcPLGYAZ8), section "Self-hosting reference you can link into").

`self-hosting/environment-variables.mdx` claims every variable but misses eight, rows can't be linked, and Required uses six vocabularies.

- **H11:** an anchor on every variable row (# on hover like headings); columns Variable, Required, Description everywhere; Required is Yes, Optional or "If …".
- **P18:** add `SCREENPLAY_ACP_HARNESS`, `LOCAL_BLOB_DIR`, `LOCAL_BLOB_BASE_URL`, `YJS_PERSISTENCE_DIR`, `NEXT_PUBLIC_YJS_WS_PORT`, `TAURI_CONTROL_URL`, `SCREENPLAY_DESKTOP` and `PORT` (or an Internal table); note Vercel Sandbox authenticates only through Vercel's OIDC token; add the desktop drizzle/local step and full flag list to local-build. Tighten `apps/app/test/env-docs.test.ts` to require a table row, not a mention. Check each variable still exists in code before adding it.
- **H12:** Nextra `filename=` on file contents, e.g. ```dotenv filename="apps/app/.env.local"`.


---

## D4 Catch the guides up (after D1 merges)

Docs plan PR 9 ([plan](https://claude.ai/artifact/PKkCXXHFxtXowkcPLGYAZ8), section "Catch the guides up with the app"). Describe the app as it is today; much changed since the plan was written on 30 Sep (live frames, the frame bar, Chats menu, files and memory), so verify each item in the code first and drop anything already covered.

- **P9:** collaboration.mdx: sending comment threads to the agent (Comments panel checkboxes and Send N to agent, the thread menu's Send to agent, status and Addressed chips).
- **P12:** frames.mdx: the frame bar in its real order and the status dot's states; no bar on a frame without a Workspace; device names from `lib/iframe-layer-sizes.ts`.
- **H13 + P20:** settings.mdx in the app's order, plus its missing states (hierarchy patch hunk and the product audit's one-liners).
- **P11:** Home and Player sections on keyboard-shortcuts.
- **P19:** knobs.mdx: "the code does nothing in production" instead of "Bundlers strip"; one line for `getKnobValue`; confirm the portless command in dev-server.


---

## D5 Troubleshooting page

Docs plan PR 10 ([plan](https://claude.ai/artifact/PKkCXXHFxtXowkcPLGYAZ8), section "Troubleshooting"; decision D6: one page).

Fixes for common problems sit in callouts at the ends of several pages. Add one Troubleshooting page in the Guides tab's Reference group, symptom first with a bold lead-in, and link to it from each place the symptom shows (e.g. Frames' preview states): "No coding agent detected", a preview that never loads, `DevServerPortIgnoredError`, "One branch, one workspace", Turborepo stripping `PORT`. Check each symptom's wording against the current app.


---

## H1 Download downloads the app

Homepage plan PR 7 ([plan](https://claude.ai/artifact/DpmURXQa6nPsHm7pxDpCBL), section "Fix the Download path"). Partly shipped: the "For Macs with Apple Silicon" line (#1199) and the Quickstart's real dmg name (#1206) are in.

Left:
- The release script uploads only `Screenplay_<version>_aarch64.dmg` (`apps/desktop/scripts/release.mjs`); also upload a stable `Screenplay.dmg` asset.
- Point every Download button (`apps/homepage/lib/app-url.ts`) at `https://github.com/zschiller/screenplay/releases/latest/download/Screenplay.dmg` instead of the releases page.
- Release notes: a short user-facing summary instead of only `--generate-notes`.

The link only works once a release carries the stable asset, so the PR needs a release cut on Zack's Mac (Remote Control) before the homepage change ships.


---

## A1 One menu per object

App plan PR 10 ([plan](https://claude.ai/artifact/1YkzEXxYwwWPnhpHjhLsrR), section "One menu per object, and multi-selection that acts on all of it").

A frame's sidebar menu still has only Rename and Delete (`panels/layer-rows/iframe-layer-row.tsx`) while its toolbar menu has more; documents and groups have no menu on the canvas; `multiSelected` in `canvas-member-layer.tsx` counts frames and documents but not groups.

- **I7:** the same frame menu in the sidebar and the toolbar (Rename, Duplicate ⌘D, then Device size, Fit to content, Workspace, then Delete, adjusted to today's items). Documents and groups get the same treatment, and a selected document or group shows … on its canvas label. Use the shared menu component.
- **I6:** groups count toward multi-selection; the frame toolbar hides, as it does for two frames.

Menus changed in the 10-03 design audit (mockup menu, workspace header menu); build on what's there now.


---

## A2 Workspace to chat and frames (after A1 merges)

App plan PR 11 ([plan](https://claude.ai/artifact/1YkzEXxYwwWPnhpHjhLsrR), section "Get from a Workspace to its chat, its frames and its actions"). I8 shipped in #1540.

Left:
- **P3:** an Open chat button (stock outline Button) in the Workspace hover card (`workspace-hover-card.tsx`), which shows on the group pill, frame pill and address bar.
- **P10:** Add frame in the Workspace's chat menu, placing a frame for that Workspace beside its group (`addIframeLayerForAgent` already exists).

Follow today's copy rules: menus say "chat"; "workspace" only for code and previews.


---

## A3 Creating PR progress and one name

App plan PR 14 ([plan](https://claude.ai/artifact/1YkzEXxYwwWPnhpHjhLsrR), section "Pull requests: one name, a visible reason, and progress"). I15 is moot (confirm cards were removed in #1286).

Left:
- **I14:** one pending set in `useBranchActions`: a regular spinner and "Creating PR…" while it runs, the menu item disabled so a second click can't start a second create, and the disabled reason in the stock tooltip instead of a native title.
- **One name:** the chat header says "Create PR" (`chat-panel.tsx`) while the menu says "Create pull request" (#1453). Decision A4 picked "Create PR" for the header's room, but the later copy sweep chose the long form in menus; use one, and say which in the PR.


---

## A4 Small follow-ups

App plan PR 16 ([plan](https://claude.ai/artifact/1YkzEXxYwwWPnhpHjhLsrR), section "Smaller follow-ups"). Each item is small; one PR is fine.

- **I17:** frame status screens stay readable when zoomed out: counter-scale the status block by 1/zoom, capped to the frame's size (`frame-status.tsx`). Scale only, not the rejected in-body picker.
- **Focus and loading:** focus the neighbouring tab or row after a close or delete; a comment thread card takes focus; regular-spinner or skeleton loading for the home grid and the Share people list (`rooms-view.tsx`, `share-room-dialog.tsx`).
- **Repo fixes:** add `subscribeSharedState` to `packages/screenplay-state/index.d.ts` so the docs' example type-checks; `apps/app/CONTEXT.md` still calls Room Target "planned".

