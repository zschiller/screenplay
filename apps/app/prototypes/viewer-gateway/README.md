# Viewer gateway prototype (issue #991)

**Throwaway.** This lives on the branch `claude/project-thread-m7t4mt` only and is never merged.

It answers one question: what does a read-only viewer gateway on the Mac need to serve? The gateway is a separate process from the Next sidecar. It serves one room to viewers on `localhost`, with no transport yet.

- `gateway.mjs` is the gateway. It serves the app shell (GET only, allowlisted, proxied from the sidecar), a one-way Yjs mirror of the room, and frame previews on their own origins (`f<port>.localhost`).
- `drive.mjs` is the probe that produced the findings. It opens a sharer and a viewer side by side, has the sharer edit, has the viewer try to edit, and prints what reached the Mac.
- `shots/` holds screenshots from the run in a web container against the fixture world.

## Try it on the Mac

You need Chrome, because the frame origins are `f<port>.localhost` and Safari doesn't resolve those.

```bash
# 1. A worktree for the prototype branch, so your checkout is untouched
cd ~/path/to/screenplay
git fetch origin claude/project-thread-m7t4mt
git worktree add ../screenplay-991 origin/claude/project-thread-m7t4mt
cd ../screenplay-991 && pnpm install

# 2. Open the Screenplay app. Open the room you want to share and move
#    something in it, so it is the most recently saved room.

# 3. Start the gateway. It finds the app's sidecar and that room on its own.
cd apps/app && node prototypes/viewer-gateway/gateway.mjs
#    → prints: gateway http://127.0.0.1:4100/<roomId>
```

4. Open that URL in Chrome, beside the app.
   - Move a frame, rename it, or type in a doc in the app. The Chrome tab should follow within a second.
   - Your pointer from the app should show in Chrome.
   - Frames should load live.
5. Now try to edit in Chrome: drag, delete, type. Chrome shows your edit locally, but the app never gets it, and a reload of the Chrome tab puts it back.
6. Open `http://127.0.0.1:4100/__viewer/stats` to see what the gateway served, blocked and dropped.

If it can't find the sidecar, pass it: `SIDECAR=http://127.0.0.1:<port> ROOM=<roomId> node prototypes/viewer-gateway/gateway.mjs`. Running `lsof -nP -iTCP -sTCP:LISTEN -c node` shows the port.

When you're done, stop it with Ctrl-C, then run `git worktree remove ../screenplay-991`.

## Re-run the probe in a web container

```bash
cd apps/app
pnpm screenshots:boot          # fixture world on :3947, previews on :3948
DEV_HMR=1 ROOM=room-checkout-flow SIDECAR=http://127.0.0.1:3947 node prototypes/viewer-gateway/gateway.mjs
GATEWAY=http://127.0.0.1:4100 SIDECAR=http://127.0.0.1:3947 ROOM=room-checkout-flow OUT=/tmp/shots node prototypes/viewer-gateway/drive.mjs
```

`DEV_HMR=1` passes the `next dev` HMR socket through. Without it, `next dev` never hydrates the page. A packaged sidecar is a production build and doesn't need it.
