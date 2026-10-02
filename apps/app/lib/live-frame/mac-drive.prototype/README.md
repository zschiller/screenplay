# PROTOTYPE: the agent drives your local frame on the Mac

Throwaway, not for main. Answers #1367: with one local iframe and nothing streamed, how does the
agent click, type, scroll and press keys in a frame, and see what happened? Results:
[results.md](results.md).

- **Input:** new `screenplay:drive` ops in the Sandbox Bridge (`lib/sandbox-bridge/bridge.js`):
  `click`, `hover`, `type`, `select`, `key`, `scroll`, `drag`, plus `listInteractive` and `read` for
  finding things and checking what an op did. All of them dispatch synthetic events.
- **Relay:** agent → `POST /api/prototype/mac-drive` → Yjs awareness → the canvas client
  (`client.tsx`, mounted in `canvas.tsx`) → `postMessage` to the frame's iframe → the bridge. The
  answer comes back over a plain POST.
- **Read-back:** `/snapshot-main` on the Tauri shell's control server (`thumbnail.rs`) runs
  `takeSnapshot` on the main window's WKWebView, limited to the frame's rect.

```sh
MAC_DRIVE_PROTOTYPE_TOKEN=$(openssl rand -hex 16) pnpm --filter desktop dev   # the route is off without the token
# open a canvas with a Workspace frame; the sidecar port is in the tauri dev log
export MAC_DRIVE_PROTOTYPE_TOKEN=…
node agent.mjs <port> <roomId> x bridge <sandboxName>      # push this tree's bridge.js into the Sandbox
node agent.mjs <port> <roomId> <frameId> list              # what can be acted on
node agent.mjs <port> <roomId> <frameId> '{"op":"click","target":{"text":"Settings"}}'
node agent.mjs <port> <roomId> <frameId> snapshot out.png  # the frame as shown
node scenario.mjs <port> <roomId> <frameId> ./out          # the whole gesture run behind results.md
```

`scenario.mjs` expects `drive-lab.page.tsx.txt` at `app/drive-lab/page.tsx` in the Workspace's Next
app. The frame id is the frame's layer id; a relay to `frameId: "__client"` with
`{"type":"client:frame-rect","frameId":"__window"}` lists the ones mounted.
