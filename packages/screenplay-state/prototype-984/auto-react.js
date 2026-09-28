// PROTOTYPE (#984), throwaway. Injected into the page before the app, the way
// the Sandbox Bridge is, so the prototype's own code changes by zero lines.
//
// Idea 1a, route: apply another viewer's route with pushState + popstate
// (a client-side navigation) instead of reloading the iframe, which is what
// the canvas does today.
//
// Idea 1b, React state: install the React DevTools hook, walk the fiber tree
// on every commit, and sync every JSON-able useState value, keyed by where the
// component sits in the tree plus the hook's index. Remote values are applied
// by calling that hook's own dispatch. Development builds only, same as the
// state package.
;(function () {
  let config = {}
  try {
    config = JSON.parse(localStorage.getItem("proto984") || "{}")
  } catch {}
  if (window.parent === window) return

  // ---- 1a. Soft route apply -------------------------------------------------
  window.addEventListener("message", (e) => {
    if (e.data?.type !== "screenplay:navigate") return
    const here = location.pathname + location.search + location.hash
    if (here === e.data.path) return
    history.pushState(null, "", e.data.path)
    dispatchEvent(new PopStateEvent("popstate"))
  })

  if (!config.auto) return

  // ---- 1b. Automatic React state ------------------------------------------
  const MAX_VALUE = 8 * 1024
  const remote = new Map() // key -> serialized value the room holds
  const seen = new Map() // key -> serialized value we last published or applied
  let mounted = new Map() // key -> dispatch, from the last commit
  const skipped = new Map() // key -> why it isn't synced (for the drift panel)

  function nameOf(fiber) {
    const t = fiber.type
    if (!t) return fiber.tag === 3 ? "Root" : "#" + fiber.tag
    if (typeof t === "string") return t
    return t.displayName || t.name || (t.render && t.render.name) || "Anon"
  }

  function isStateHook(hook) {
    const q = hook.queue
    return (
      q &&
      typeof q.dispatch === "function" &&
      q.lastRenderedReducer &&
      q.lastRenderedReducer.name === "basicStateReducer"
    )
  }

  function walk(root) {
    const found = new Map()
    const stack = [[root.current.child, ""]]
    while (stack.length) {
      const [start, parentPath] = stack.pop()
      for (let f = start; f; f = f.sibling) {
        const path = `${parentPath}/${nameOf(f)}${f.key != null ? "#" + f.key : ":" + f.index}`
        // Function components, forwardRef and simple memo carry a hook list.
        if (f.tag === 0 || f.tag === 11 || f.tag === 15) {
          let hook = f.memoizedState
          let i = 0
          while (hook) {
            if (isStateHook(hook)) {
              const key = `${path}@${i}`
              let s = null
              try {
                s = JSON.stringify(hook.memoizedState)
              } catch {
                skipped.set(key, "not JSON (cycle)")
              }
              if (s === undefined || s === null) {
                if (!skipped.has(key)) skipped.set(key, "not JSON")
              } else if (s.length > MAX_VALUE) skipped.set(key, "too big")
              else found.set(key, { s, dispatch: hook.queue.dispatch })
            }
            hook = hook.next
            i++
          }
        }
        if (f.child) stack.push([f.child, path])
      }
    }
    return found
  }

  function publish(changes) {
    if (Object.keys(changes).length === 0) return
    parent.postMessage({ type: "screenplay:auto-state", changes }, "*")
  }

  function onCommit(root) {
    const found = walk(root)
    const changes = {}
    const adopt = []
    for (const [key, { s, dispatch }] of found) {
      const isNew = !mounted.has(key)
      if (s === seen.get(key)) continue
      if (isNew && remote.has(key) && remote.get(key) !== s) {
        // Newly mounted: the room's value wins over the component's default.
        adopt.push([dispatch, key, remote.get(key)])
        continue
      }
      seen.set(key, s)
      changes[key] = JSON.parse(s)
    }
    mounted = new Map([...found].map(([k, v]) => [k, v.dispatch]))
    publish(changes)
    if (adopt.length)
      queueMicrotask(() => {
        for (const [dispatch, key, s] of adopt) {
          seen.set(key, s)
          dispatch(JSON.parse(s))
        }
      })
  }

  window.addEventListener("message", (e) => {
    if (e.data?.type !== "screenplay:auto-state-apply") return
    for (const [key, value] of Object.entries(e.data.state)) {
      const s = JSON.stringify(value)
      remote.set(key, s)
      if (seen.get(key) === s) continue
      const dispatch = mounted.get(key)
      if (!dispatch) continue
      seen.set(key, s)
      dispatch(value)
    }
  })

  // Expose what's synced so the room's drift panel can show it.
  window.__proto984 = {
    keys: () => [...mounted.keys()],
    skipped: () => Object.fromEntries(skipped),
  }

  // A minimal DevTools global hook. React DOM calls inject() when it loads and
  // onCommitFiberRoot() after every commit.
  let nextId = 1
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(renderer) {
      const id = nextId++
      this.renderers.set(id, renderer)
      return id
    },
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      try {
        onCommit(root)
      } catch (err) {
        console.warn("[proto984] walk failed", err)
      }
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
  }
})()
