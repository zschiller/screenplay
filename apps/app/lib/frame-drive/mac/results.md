# Real input on the Mac: results (#1385)

What closes each Frame Drive gap on the Mac, and where it was checked. The
earlier table for synthetic input (Sandbox Bridge only) is
`apps/app/lib/live-frame/mac-drive.prototype/results.md` on branch
`claude/project-thread-f2mdmm` (#1367).

How it works: the desktop shell's `/drive-input` (`apps/desktop/src-tauri/src/drive_input.rs`)
builds `NSEvent`s and hands them to the main window's `WKWebView` responder
methods (`mouseDown:`, `keyDown:`, `performKeyEquivalent:`, `copy:` ...), never
`CGEventPost` or `-[NSWindow sendEvent:]`. The sidecar plays each gesture
(`real-input.ts`): the frame's bridge finds the target, the canvas lets the
frame take the pointer and keyboard for the moment it lands
(`canvas/take-input.ts`), and the shell sends the events.

Columns:

- **Chrome**: the contract suite and `mac-backend.browser.test.ts`, with
  Chrome's CDP input standing in for the shell. Checks everything but the
  shell's AppKit calls. Runs in CI.
- **Mac**: a desktop build of this branch on Zack's Mac (2026-10-03), the
  window in front, with the 10 gestures below played once each through the
  agent's own `frame_*` driver. Every event the page saw was trusted. "not
  run" rows weren't part of that run.

| Gap / case | Closed by | Chrome | Mac |
| --- | --- | --- | --- |
| Focus in the cross-origin frame | canvas focuses the iframe, bridge focuses the field | ✅ | ✅ |
| Key events type (`key-typing`) | `keyDown:` | ✅ | ✅ field reads "a" |
| Tab (`tab`) | `keyDown:` Tab | ✅ | ✅ |
| Rich text (`rich-text`) | bridge puts the caret, then `keyDown:` | ✅ | ✅ box reads "hi" |
| CSS `:hover` | `mouseMoved:` | ✅ | ❌ no `pointerenter`: the canvas took the pointer back before WebKit delivered the move. Now waits like a click; not re-run |
| Page's Copy button (`clipboard`) | real click (user activation); pasteboard set aside and restored | ✅ | ✅ copied "link" |
| ⌘C / ⌘X / ⌘V / ⌘A | `copy:` `cut:` `paste:` `selectAll:`; a paste gets the agent's own copy | ✅ | ✅ ⌘V pasted "link", ⌘A selected; ⌘C ⌘X not run |
| File picker (`file-picker`) with Workspace files | swizzled `runOpenPanelWithParameters:` answers with the files, no panel | ✅ | ✅ input holds the file, `change` fired, no panel |
| File picker, the person's own click | wry's Finder panel, unchanged | n/a | not run |
| Native select (`native-select`) | stays a gap: `frame_select` | gap | not run |
| Date, time, colour (`native-picker`) | stays a gap: `frame_type` | gap | not run |
| Window in the background / not key | events go to the view, no activation | n/a | not run (window in front) |
| Window occluded | same | n/a | ❌ a canvas that first loads in a fully covered window never connects, so the agent hears it isn't showing; covered after loading not run |
| Window hidden (closed with the red button) | point can't be hit: bridge plays it | n/a | not run |
| Frame zoomed | point scaled by the frame's transform | ✅ (50%) | not run |
| Frame scrolled off the canvas or covered | point can't be hit: bridge plays it | ✅ | not run |
| Person's pointer doesn't move, Screenplay doesn't activate | no `CGEventPost`, no `sendEvent:` | n/a | ✅ pointer never moved; activation not checked (window in front) |
| Person's clipboard unchanged after an agent copy or paste | held and restored by the shell | ✅ | ✅ same before and after |
