# PROTOTYPE #984, throwaway

How far can `@screenplay.space/state` sync a frame without hand-wiring each key?

```bash
cd packages/screenplay-state/prototype-984
npm install && npm start          # http://localhost:4984/__room
node drive.mjs                    # scripted scenario, prints the drift table per setting
node clobber.mjs                  # does a reloading viewer wipe the room's state?
```

The room shows two viewers of one Northwind frame and relays messages the way
the canvas and Yjs do. The toggles in its header:

- **Route sync**: reload the other viewer's iframe (today) or navigate it client-side (1a, `auto-react.js`).
- **Room state wins when a viewer loads**: `state-patched.js`, a copy of the package whose frame asks the room for its state before publishing.
- **Share zustand store in one line** (2, `share-store.js`).
- **Automatic React state** (1b, `auto-react.js`): a DevTools-hook fiber walk that syncs every JSON-able `useState`.

Findings: https://github.com/zschiller/screenplay/issues/984
