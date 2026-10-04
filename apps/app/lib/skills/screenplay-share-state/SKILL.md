---
name: screenplay-share-state
description: Share a page’s UI state with the canvas so every viewer sees and drives the same state. Use when the user asks to sync, expose or show a piece of app state (the current user, the cart, the open tab) to everyone on the canvas.
---

# Skill: Sharing UI state with the canvas

**Shared state** mirrors a piece of a page’s UI state up to the canvas, which
stores it and pushes it down to every viewer’s copy of the page, so a change
in one viewer’s page shows in everyone’s. The frame’s route pill shows a
`{ }` icon whose hover reveals the JSON; the canvas has no editor for it.
Outside a canvas every call is a no-op, so the code is safe to commit.

**Knobs or shared state:** a knob is a value people _set_ from the canvas
(padding, colour; see screenplay-add-knob). Shared state is state the page
_owns_ and everyone should see the same (current user, open step).

Where it goes decides how you declare it: **app code** in your Workspace uses
the `@screenplay.space/state` package; a **Mockup** uses the `screenplay`
global its page already has.

## In app code

1. Read `package.json`. When `@screenplay.space/state` isn’t in
   `dependencies`, install it first, so a fresh clone still builds:

   ```
   run_command "npm" ["install", "--save", "@screenplay.space/state"]
   ```

2. Find the state that already exists: the `useState`, `useReducer`, store
   hook or context value the user means. It stays the source of truth;
   shared state is a **bridge** beside it.
3. Call `useSharedState(key, value, setter)` next to it, on every render.
   Passing the setter syncs both ways; leave it out to publish a derived
   snapshot one way.

   ```tsx
   import { useSharedState } from "@screenplay.space/state"

   const [count, setCount] = useState(0)
   useSharedState("count", count, setCount)

   const user = useUser()
   useSharedState("user", user ? { id: user.id, role: user.role } : null)
   ```

The route pill shows `{ }` as soon as the page publishes.

**A zustand store** shares whole with one line beside its `create()`; its
plain-JSON fields sync both ways and its actions keep working:

```ts
import { shareStore } from "@screenplay.space/state"

export const useSales = create((set) => ({/* existing store */}))
shareStore("sales", useSales)
```

**Outside React** (event handlers, store middleware):

```ts
import { setSharedState, subscribeSharedState } from "@screenplay.space/state"

const remove = setSharedState("session", { id: "…", role: "admin" })
const unsubscribe = subscribeSharedState("session", (next) => {
  /* remote update */
})
```

## On a Mockup

The page already has `screenplay.shareState(key, initial, onChange)`, which
returns `{ get, set }`. `onChange` runs at once with the current value and
again on every change, local `set` included, so draw the page from it. Add
it by rewriting the page with `update_mockup`.

```html
<script>
  const tab = screenplay.shareState("tab", "overview", (value) => {
    document.body.dataset.tab = value
  })
  document.querySelector("#plans").onclick = () => tab.set("plans")
</script>
```

## Values

- **Stable keys**: the canvas stores each value under its `key`, so a
  renamed key resets. The room’s value wins when a page loads.
- **Plain JSON**: functions are dropped, a `Date` becomes a string, class
  instances lose their prototype, and `BigInt` or circular values drop the
  call. A shared store keeps those fields local.
- **Small summaries**: everything shared on a page is capped at 64 KB
  together, so publish ids, counts and mode flags rather than whole objects.
- **Public to the room**: every viewer can read it and it’s stored with the
  canvas, so share only what you’d say in a meeting, never tokens or
  private data.
