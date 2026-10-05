import * as React from "react"

const mq = () => matchMedia("(prefers-color-scheme: dark)")

type Bridge = { theme?: (onChange: (scheme: "light" | "dark") => void) => void }

/**
 * The page's theme: the app's on a Screenplay canvas, which tells the page
 * through `screenplay.theme`, and the system's anywhere else (or until the
 * canvas says). Puts the app's `dark` class on <html>; captures show the
 * theme the page is in.
 */
export function useTheme() {
  const [system, setSystem] = React.useState(() => mq().matches)
  const [app, setApp] = React.useState<boolean | null>(null)
  React.useEffect(() => {
    const m = mq()
    const on = () => setSystem(m.matches)
    m.addEventListener("change", on)
    ;(window as { screenplay?: Bridge }).screenplay?.theme?.((scheme) =>
      setApp(scheme === "dark")
    )
    return () => m.removeEventListener("change", on)
  }, [])
  const dark = app ?? system
  React.useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    document.documentElement.style.colorScheme = dark ? "dark" : "light"
  }, [dark])
  return dark
}

export const ThemeContext = React.createContext(false)
