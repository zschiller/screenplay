import * as React from "react"

import { Button } from "@workspace/ui/components/button"

const mq = () => matchMedia("(prefers-color-scheme: dark)")

/**
 * The page follows the system theme until the viewer flips it, and puts the
 * app's `dark` class on <html>. Captures show the theme the page is in.
 */
export function useTheme() {
  const [override, setOverride] = React.useState<boolean | null>(null)
  const [system, setSystem] = React.useState(() => mq().matches)
  React.useEffect(() => {
    const m = mq()
    const on = () => setSystem(m.matches)
    m.addEventListener("change", on)
    return () => m.removeEventListener("change", on)
  }, [])
  const dark = override ?? system
  React.useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    document.documentElement.style.colorScheme = dark ? "dark" : "light"
  }, [dark])
  return [dark, () => setOverride(!dark)] as const
}

export const ThemeContext = React.createContext(false)

/** Light / Dark switch, so the other theme's captures are one tap away. */
export function ThemeButton({
  dark,
  toggle,
}: {
  dark: boolean
  toggle: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      // Its label lines up with the page edge, not its padding
      className="-mr-2.5 text-muted-foreground"
      onClick={toggle}
    >
      {dark ? "Light" : "Dark"}
    </Button>
  )
}
