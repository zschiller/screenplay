// PROTOTYPE (#984), throwaway. Idea 2: one line shares a whole zustand store,
// instead of one useSharedState call per key.
//
//   shareStore("pricing", usePricingStore)
//
// The store's data (functions are dropped by JSON) is published under one
// key, and remote values are merged back with store.setState, which keeps the
// store's actions. The package's own diffing stops the echo.
import { setSharedState, subscribeSharedState } from "@screenplay.space/state"

const plain = (state) => JSON.parse(JSON.stringify(state))

export function shareStore(key, store) {
  subscribeSharedState(key, (remote) => store.setState(remote))
  setSharedState(key, plain(store.getState()))
  store.subscribe((state) => setSharedState(key, plain(state)))
}
