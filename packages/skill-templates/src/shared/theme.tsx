import * as React from "react"

const mq = () => matchMedia("(prefers-color-scheme: dark)")

/**
 * The page follows the system theme and puts the app's `dark` class on
 * <html>. Captures show the theme the page is in.
 */
export function useTheme() {
  const [dark, setDark] = React.useState(() => mq().matches)
  React.useEffect(() => {
    const m = mq()
    const on = () => setDark(m.matches)
    m.addEventListener("change", on)
    return () => m.removeEventListener("change", on)
  }, [])
  React.useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    document.documentElement.style.colorScheme = dark ? "dark" : "light"
  }, [dark])
  return dark
}

export const ThemeContext = React.createContext(false)
