// The "Without React" example from the shared state guide
// (apps/docs/content/guides/building/shared-state.mdx), type-checked by
// `pnpm typecheck` so the published types can't drift from the docs again.
import {
  setSharedState,
  subscribeSharedState,
  clearSharedState,
} from "../index.js"

const remove = setSharedState("session", { id: "u_1", role: "admin" })
const unsubscribe = subscribeSharedState("session", (next) => {
  console.log("session changed", next)
})

remove() // or clearSharedState("session")
clearSharedState("session")
unsubscribe()
