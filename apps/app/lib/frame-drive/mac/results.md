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
- **Mac**: a local desktop build on the Mac, over Remote Control.

| Gap / case | Closed by | Chrome | Mac |
| --- | --- | --- | --- |
| Focus in the cross-origin frame | canvas focuses the iframe, bridge focuses the field | ✅ | not run yet |
| Key events type (`key-typing`) | `keyDown:` | ✅ | not run yet |
| Tab (`tab`) | `keyDown:` Tab | ✅ | not run yet |
| Rich text (`rich-text`) | bridge puts the caret, then `keyDown:` | ✅ | not run yet |
| CSS `:hover` | `mouseMoved:` | ✅ | not run yet |
| Page's Copy button (`clipboard`) | real click (user activation); pasteboard set aside and restored | ✅ | not run yet |
| ⌘C / ⌘X / ⌘V / ⌘A | `copy:` `cut:` `paste:` `selectAll:`; a paste gets the agent's own copy | ✅ | not run yet |
| File picker (`file-picker`) with Workspace files | swizzled `runOpenPanelWithParameters:` answers with the files, no panel | ✅ | not run yet |
| File picker, the person's own click | wry's Finder panel, unchanged | n/a | not run yet |
| Native select (`native-select`) | stays a gap: `frame_select` | gap | not run yet |
| Date, time, colour (`native-picker`) | stays a gap: `frame_type` | gap | not run yet |
| Window in the background / not key | events go to the view, no activation | n/a | not run yet |
| Window occluded | same | n/a | not run yet |
| Window hidden (closed with the red button) | point can't be hit: bridge plays it | n/a | not run yet |
| Frame zoomed | point scaled by the frame's transform | ✅ (50%) | not run yet |
| Frame scrolled off the canvas or covered | point can't be hit: bridge plays it | ✅ | not run yet |
| Person's pointer doesn't move, Screenplay doesn't activate | no `CGEventPost`, no `sendEvent:` | n/a | not run yet |
| Person's clipboard unchanged after an agent copy or paste | held and restored by the shell | ✅ | not run yet |
