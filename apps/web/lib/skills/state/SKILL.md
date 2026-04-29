---
name: state
description: Bridge a piece of the prototype's UI state to the screenplay canvas so it syncs across every viewer in the room (and into the prototype player). The canvas shows a tiny indicator on the route pill — read-only at the canvas surface, hover for the JSON. Use whenever the user asks to expose internal app state to the screenplay session ("share the current user", "sync the cart across viewers", "let me see what mode this is in", "expose this to the editor").
---

# Skill: Sharing UI state with the canvas

`@screenplay.space/state` mirrors a piece of the prototype's UI state up
to the screenplay canvas. The canvas persists it on the artboard via Yjs
and pushes it back down into every connected client's iframe — so a state
change in one viewer's prototype shows up in every other viewer's
prototype within the same room. The canvas itself shows a tiny
`{ }` curly-brace icon inside the route pill; hovering reveals the full JSON.
There's no editor UI on the canvas today (that may come later).

When the prototype renders outside a screenplay canvas — production
builds, standalone dev, anything not iframed inside screenplay — every
API on the package is a no-op. Committing `useSharedState` to production
is safe.

## When to use this vs. knobs

| Use **knobs** for…                          | Use **state** for…                              |
| ------------------------------------------- | ----------------------------------------------- |
| Designer-tunable values (padding, color)    | App-internal state (current user, route params) |
| Canvas-driven inputs                        | Prototype-driven outputs                        |
| Read in the prototype                       | Surface for visibility + multi-client sync      |

If the user wants to *see* what state the prototype is in, use this. If
they want to *control* a value from the canvas, use knobs.

## How to add shared state

1. **Make sure `@screenplay.space/state` is installed.** Read
   `package.json`. If it isn't listed in `dependencies`, install it:

   ```
   run_command "npm" ["install", "--save", "@screenplay.space/state"]
   ```

   Skip this step if it's already there.

2. **Find the existing UI state.** This skill is about wiring state
   that's already there — not introducing new state. Look for the
   `useState`, `useReducer`, store hook, or context value the user
   wants to expose.

3. **Call `useSharedState` next to it.** Pick a stable, descriptive
   `key`. Pass the value. Pass the setter (or whatever updates the
   state) to opt into bidirectional sync — without it, the state
   publishes one way only.

   ```tsx
   import { useSharedState } from "@screenplay.space/state"

   function App() {
     // Existing state — leave it alone.
     const [count, setCount] = useState(0)

     // New: bidirectional bridge to the canvas. Other clients in the
     // same room will see updates and write them back here.
     useSharedState("count", count, setCount)

     return <button onClick={() => setCount((c) => c + 1)}>{count}</button>
   }
   ```

4. **For derived snapshots, omit the setter.** When the state isn't
   directly settable (e.g. it comes from a hook you don't control, or
   it's a computed projection), publish-only is fine:

   ```tsx
   const user = useUser()
   useSharedState("user", user ? { id: user.id, role: user.role } : null)
   ```

5. **Commit and push.** The canvas picks up the new key automatically
   — no manifest, no registration. The route pill will sprout a
   `{ }` curly-brace icon as soon as the prototype publishes.

## Patterns

- **Wire existing state, don't replace it.** `useSharedState` is a
  bridge — it doesn't own the state. Keep `useState` / store hooks /
  context as the source of truth and let `useSharedState` mirror it.
- **Pick stable keys.** The canvas keys persisted state by `key`.
  Renaming a key resets it. Treat keys like `id`s.
- **Publish summaries, not raw blobs.** The combined payload is
  capped at 64 KB. If the user wants to share a big object, publish
  a small projection (e.g. counts, ids, mode flags) instead.
- **Don't share secrets.** The published payload is visible to every
  viewer in the room and stored in Yjs. Never publish auth tokens,
  PII you wouldn't paste in chat, or anything you wouldn't say in a
  meeting.

## Non-React API

Reach for this when you need to publish from outside React (event
handlers, store middleware, Zustand subscriptions, etc.):

```ts
import {
  setSharedState,
  subscribeSharedState,
  clearSharedState,
} from "@screenplay.space/state"

const remove = setSharedState("session", { id: "...", role: "admin" })

const unsubscribe = subscribeSharedState("session", (next) => {
  // remote update from another client
})

// teardown
remove()
unsubscribe()
```

## Rules

- **Always run `npm install --save @screenplay.space/state` before
  using `useSharedState` for the first time** — committing an import
  without the dep listed in `package.json` would break the user's
  build on a fresh clone.
- **Pure declarations**: `useSharedState` must run on every render.
  Don't conditionally call it.
- **No functions in values.** They're stripped during JSON
  serialization. Same goes for `Date` (becomes a string), class
  instances (lose their prototype), `BigInt` (the call is dropped),
  and circular references.
- **Don't fight `useState`.** If the user has `[count, setCount]`,
  keep them both. `useSharedState("count", count, setCount)` is the
  whole bridge — don't refactor `count` out from under their other
  consumers.
