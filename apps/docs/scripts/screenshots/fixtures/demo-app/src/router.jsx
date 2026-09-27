import { useEffect, useState } from "react"
export function usePath() {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => { const f = () => setPath(location.pathname); addEventListener("popstate", f); return () => removeEventListener("popstate", f) }, [])
  return path
}
export function Link({ to, children, ...rest }) {
  return <a href={to} {...rest} onClick={(e) => { e.preventDefault(); history.pushState(null, "", to); dispatchEvent(new PopStateEvent("popstate")) }}>{children}</a>
}
