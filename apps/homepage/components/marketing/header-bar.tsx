/** The sticky header's bar: always solid, with its rule. */
export function HeaderBar({ children }: { children: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background">
      {children}
    </header>
  )
}
