# PROTOTYPE: mirroring the leader's frame (#982)

Throwaway. Lives on the branch `claude/project-thread-frt10a`, never on main.

**Question.** Can the host's real iframe be the one live copy of a frame, with
every other viewer seeing an rrweb mirror of its DOM, and with the driver's
input forwarded from their mirror back to the host (per #981, the live copy
stays in the tab it started in)?

## Run it

```sh
npm install
node serve.mjs            # builds Northwind + a Mirror lab page, serves everything
open http://127.0.0.1:4100/host.html?path=/lab    # the live copy runs here
open http://127.0.0.1:4100/watcher.html?name=Avery # a mirror; press Drive
node measure.mjs          # scripted checks, traffic and latency -> results/
node make-clip.mjs        # (re)records clip.webm for the lab's <video>
```

## Pieces

| File | Stands in for |
| --- | --- |
| `recorder.js` | What the Sandbox Bridge would gain: `rrweb.record` posting events to the canvas, and replaying forwarded input. Injected into the demo site's `<head>` the way the bridge proxy injects `bridge.js`. |
| `forwarding.js` | The logic worth keeping: `captureInput` (mirror DOM event to message), `shouldApply` (only the driver's input lands), `applyInput` (message to synthetic events in the live frame). |
| `app.js` | The canvas: the host tab relays the frame's events, the watcher tab replays them with rrweb in live mode and forwards the driver's input. |
| `serve.mjs` | Demo site on :4101, a cross-origin widget on :4102, and a relay on :4100 standing in for the room connection. It counts every byte. |
| `lab/Lab.jsx` | A page with one of each thing a mirror might get wrong. |

## Findings

See `results/results.json` and the screenshots in `results/`. The resolution
comment on #982 has the summary.

Mirror bugs found and fixed in `app.js` (all on the watcher side):
- rrweb's live mode never flushes its virtual DOM, so a late joiner's backlog never showed (`useVirtualDom: false`).
- Every full snapshot rebuild uses `document.open()`, which drops the mirror's input listeners; they're re-attached on `fullsnapshot-rebuilded`.
- The host's echo of an older input value overwrote what the driver had typed since and ate characters; echoes for a field typed in during the last second are skipped.
- rrweb closes a modal `<dialog>` by removing `open`, which leaves it in the top layer and the whole mirror inert; it's closed properly.
- `rrweb-paused` stays on the mirror in live mode and pauses every CSS animation; it's removed.
- rrweb's `scrolling="no"` stopped the driver scrolling the page; it's removed.
- Escape on the mirror closed the mirror's own copy of a native dialog; the mirror now cancels it and the host closes its dialog (a synthetic Escape doesn't, so `applyInput` does what the browser would).
