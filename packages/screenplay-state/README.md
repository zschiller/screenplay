# @screenplay.space/state

Bridge a prototype's UI state to the parent screenplay canvas so it syncs
across every viewer in the room. The canvas persists the merged state per
artboard via Yjs and pushes it back down into every connected client's
iframe — change `currentUser` in one viewer's prototype and every other
viewer's prototype updates too.

The canvas itself doesn't render an editor for shared state today; it shows
a tiny indicator on the route pill with the JSON in a tooltip. That's
deliberate — direct editing from the canvas may come later.

The package is dev-only by design. In any build with `NODE_ENV` set to
anything other than `"development"`, every API on this module is a no-op
and the postMessage paths are dead-code-eliminated by the bundler.
Nothing ever leaves the page, no inbound listener is attached, no remote
setter is ever invoked. Shipping `useSharedState` calls to production is
safe.

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

The module gates everything on `process.env.NODE_ENV === "development"`
plus `window.parent !== window`, evaluated once at load time. In any
non-development build — production, test, or a no-bundler load where
`NODE_ENV` isn't defined — the publish path never runs, the in-memory
map is never written to, and the inbound message listener is never
installed. Bundlers (Next, Vite, esbuild, webpack) statically inline
`process.env.NODE_ENV`, so a production bundle dead-code-eliminates
those branches entirely; the package contributes effectively zero
runtime to a prod build.

That's the production-safety story: a prototype that ships
`useSharedState` calls in committed code, then gets iframed by some
non-screenplay parent in production, cannot have its state read or
written via this protocol — none of the protocol is wired up at all.

In development, the legacy gate (`window.parent !== window`) still
applies. A prototype rendered standalone never publishes; only when
hosted by a real screenplay canvas does the bridge come alive.

## Releasing

Publishing is automated via the **Publish @screenplay.space/state** workflow
in GitHub Actions. Open the Actions tab, pick that workflow, and click **Run
workflow** — same flow as the knobs package.

## License

MIT
