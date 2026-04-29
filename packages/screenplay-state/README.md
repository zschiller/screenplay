# @screenplay.space/state

Bridge a prototype's UI state to the parent screenplay canvas so it syncs
across every viewer in the room. The canvas persists the merged state per
artboard via Yjs and pushes it back down into every connected client's
iframe — change `currentUser` in one viewer's prototype and every other
viewer's prototype updates too.

The canvas itself doesn't render an editor for shared state today; it shows
a tiny indicator on the route pill with the JSON in a tooltip. That's
deliberate — direct editing from the canvas may come later.

When the prototype runs outside a screenplay canvas — production builds,
standalone dev, anything that isn't iframed inside screenplay — every API
on this module is a no-op. Nothing ever leaves the page. Shipping
`useSharedState` calls to production is safe.

## Install

```bash
npm install --save @screenplay.space/state
```

`react >= 17` is a peer dependency.

## Use

Bidirectional — wire existing UI state both ways:

```tsx
import { useSharedState } from "@screenplay.space/state"

function Counter() {
  const [count, setCount] = useState(0)
  useSharedState("count", count, setCount)
  return <button onClick={() => setCount((c) => c + 1)}>{count}</button>
}
```

Now bumping `count` in one client's iframe shows up in every other client's
iframe in the same room.

Publish-only — derived snapshot, no remote write-back:

```tsx
const user = useUser()
useSharedState("user", user ? { id: user.id, role: user.role } : null)
```

Stable, descriptive `key`s persist across reloads. Rename a key and the
canvas drops the old entry; treat it like an `id`.

## What syncs

| Aspect                      | Behavior                                                       |
| --------------------------- | -------------------------------------------------------------- |
| Local change → other clients | Yes (via canvas + Yjs)                                         |
| Other clients → local        | Yes when you pass `setter` (3-arg form)                        |
| Canvas user editing          | No editor UI yet — read-only at the canvas surface             |
| Persistence across reloads   | Yes — state lives on the artboard until cleared                |
| Cross into prototype player  | Yes — same protocol, same room, same Yjs                       |

## Non-React API

```ts
import {
  setSharedState,
  subscribeSharedState,
  clearSharedState,
} from "@screenplay.space/state"

const remove = setSharedState("session", { id: "...", role: "admin" })

const unsubscribe = subscribeSharedState("session", (next) => {
  console.log("session changed", next)
})

// later
remove()
unsubscribe()
// or drop a key without holding the remover:
clearSharedState("session")
```

## What's published

Values are JSON-serialized before being posted to the canvas. Functions,
class instances, `BigInt` (throws — caught and dropped), `undefined`, and
circular references are stripped or the entry is skipped. The combined
payload is capped at 64 KB; oversize updates log a warning and are not
published.

## Production safety

The module checks `window.parent !== window` once at load time. Outside a
screenplay frame the publish path never runs, the in-memory map is never
written to, and the inbound message listener is never installed. There is
no other gate — if a prototype is hosted by another iframe (e.g. embedded
in a docs site) it will *not* leak unless that parent listens for
`screenplay:shared-state` postMessages, and even then only the data the
prototype voluntarily passes to `useSharedState` is exposed.

## Releasing

Publishing is automated via the **Publish @screenplay.space/state** workflow
in GitHub Actions. Open the Actions tab, pick that workflow, and click **Run
workflow** — same flow as the knobs package.

## License

MIT
