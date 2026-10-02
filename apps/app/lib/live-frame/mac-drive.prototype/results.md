# The agent drives your local frame on the Mac: results

PROTOTYPE notes, not for main. Measured 2026-10-02 on a Mac in `tauri dev` (debug shell, live
`next dev` sidecar), against a real Workspace frame: the `familiar.computer` repo's Next 15 / React
19 dev server in a local Sandbox, shown in a canvas in the Tauri window.

That Workspace's own page is a static landing page with nothing to click, so the gestures ran on a
lab page added to the same app for the run (`drive-lab.page.tsx.txt`): a Settings tab, a Billing
dialog with a form, and one control per risky gesture. **It is a real frame and a real dev server,
but not a real product UI.** No component library (Radix, dnd-kit) was in the page; the pointerdown
menu and the pointer slider imitate how those listen.

The Tauri window was in the background for the run (`document.hasFocus()` false, visibility
`visible`). Nobody clicked in the frame, so it never had a user gesture.

## Verdict

- **Driving works for what a page's own JavaScript handles.** The agent went Settings → Billing →
  filled the form → picked from a menu → submitted, and read back the saved plan. Everyone with the
  canvas open sees it happen in the real frame.
- **Nothing the browser does for a real gesture works.** No file picker, no native select or date
  popup, no clipboard, no `:hover`, no typed characters from key events, no Tab. Most have a
  workaround that sets the result directly. The file picker and the clipboard have none.
- **Focus can't move into the frame.** WebKit ignored `element.focus()` in the cross-origin frame,
  so `document.activeElement` stayed `body` throughout, with the app in the background and in
  front. Typing into inputs still works because the op sets the value. Rich-text editors and
  anything that reacts to focus don't.
- **Fast enough.** A click paints about 95 ms after the agent's call. Reading the interactive
  elements takes about 50 ms.
- **The shell can snapshot the real webview.** A PNG of the frame as shown takes about 60 ms, with
  the window in the background. It shows page content and the canvas chrome over it, not native
  popups.

## What worked and what didn't

| Gesture | Result | Note |
|---|---|---|
| Click through tabs into a dialog | works | |
| Type into React controlled inputs | works | sets the value through the prototype setter, then `input` and `change` |
| Menu that opens on `pointerdown` | works | Radix-style listener, not Radix itself |
| Checkbox | works | an untrusted `click` still toggles it |
| Enter submits a form | works, emulated | the key event alone does nothing, so the op calls `form.requestSubmit()` |
| Shortcut the page handles (⌘Enter) | works | |
| Client-side link (`next/link`) | works | |
| Scroll the page or an inner scroller | works | `scrollBy`, no wheel events |
| Click below the fold | works | scrolled into view first |
| HTML5 drag and drop | works | with a synthetic `DataTransfer`; no drag image is drawn |
| Pointer drag (slider) | works | `setPointerCapture` didn't throw |
| Native `<select>` | value only | the popup can't be opened (`showPicker` isn't there for selects) |
| Date input | value only | `showPicker`: "called from cross-origin iframe" |
| File picker | **no** | the click arrives untrusted and opens nothing; `showPicker` "requires a user gesture" |
| Page's own Copy button | **no** | `clipboard.writeText` → `NotAllowedError` |
| Clipboard read, `execCommand` copy and paste | **no** | `NotAllowedError`, `false`, `false` |
| CSS `:hover` menu | **no** | JS `mouseenter` handlers fire; `:hover` never matches |
| A key event types its character | **no** | use the `type` op |
| Tab moves focus | **no** | |
| Focus an element | **no** | `focus()` ignored; focusing the iframe from the canvas first didn't help |
| Type into `contenteditable` | **no** | `execCommand("insertText")` needs focus |
| Fullscreen | **no** | `requestFullscreen` isn't exposed in the frame |

Whether a file picker opened was judged from the page (no error-free path, no `change`), not by
looking at the screen.

## Timing

One Mac, everything local. p50 / p90 in ms.

| Step | Click (n=49) | Type (n=5) | Key (n=4) |
|---|---|---|---|
| Agent call → server publishes on awareness | 5 / 6 | 5 / 8 | 4 / 5 |
| Awareness → canvas client | 20 / 74 | 17 / 23 | 16 / 17 |
| Canvas client → bridge (`postMessage`) | 26 / 77 | 24 / 29 | 23 / 25 |
| Dispatch in the frame | 1 / 2 | 1 / 3 | 1 / 2 |
| **Agent call → frame painted** | **94 / 194** | **92 / 93** | **92 / 95** |
| Whole call, answer back at the agent | 106 / 201 | 97 / 100 | 98 / 101 |

"Painted" is two animation frames after dispatch, about 40 ms of the total here. 40 of the clicks
were sent back to back, which is where the click p90 comes from. The two hops through the canvas
client cost about 45 ms. Why they aren't closer to zero wasn't looked into; a background window is
one suspect.

| Read | p50 / p90 | |
|---|---|---|
| `listInteractive` (n=20) | 48 / 58 ms | labels, selectors and rects of what can be acted on |
| `getPageSnapshot` (existing bridge read, n=10) | 48 / 63 ms | 23 KB of DOM and CSS for this page |
| Native snapshot of the frame (n=15) | 57 / 68 ms | 22 ms to ask the client for the rect, 29 ms for `takeSnapshot`; 714×540 PNG (2×), 35–75 KB |
| Native snapshot of the whole window | 45 ms | 3024×1898 |

Shots from the run: `shots/` (the dot is the agent's cursor, drawn by the bridge).

## What matters in practice

- **File uploads** need another route: the agent can't open the picker, and the bridge can't set
  `input.files` to a file from disk. A bridge op that builds a `File` from bytes the agent sends
  and assigns it through a `DataTransfer` is the usual answer. Not tried.
- **Clipboard** is out. A flow that ends in "Copy link" can be driven up to the button, and the
  agent can read the value from the DOM instead.
- **Hover-only UI** built with CSS can't be opened. Hover UI built with JS handlers can.
- **Focus** is the widest gap: focus rings, `onFocus`/`onBlur` validation, comboboxes that open on
  focus and rich-text editors all depend on it. Not tried: whether `focus()` starts working once
  the user has clicked in the frame, and whether an `allow` attribute on the iframe changes the
  clipboard result.
- **Native popups** never appear, to the agent or to anyone watching. The streamed prototype
  (`../webrtc.prototype`) shows them.

## Not measured

- A frame in a real product UI with a component library.
- A minimised, hidden or fully covered window (`requestAnimationFrame` and the snapshot may behave
  differently).
- A frame that is off-screen or zoomed on the canvas. The snapshot is of the rect on screen, so it
  would be clipped or scaled.
- Two people with the canvas open. Every open client would run the op in its own copy of the
  frame.
- Trusted input injected by the shell into the WKWebView, which is the other way to get real
  gestures.
