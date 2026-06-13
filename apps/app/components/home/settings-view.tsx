"use client"

import { useSyncExternalStore } from "react"
import { useTheme } from "next-themes"
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { HomeScrollBody } from "./home-scroll-body"
import { RepoConfigsPanel } from "./repo-configs-panel"

const THEMES: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
]

export function SettingsView() {
  const header = (
    <header
      data-tauri-drag-region
      className="flex h-14 items-center bg-background"
    >
      <div className="mx-auto flex w-full max-w-5xl items-center px-16">
        <h1 className="text-2xl font-normal">Settings</h1>
      </div>
    </header>
  )
  return (
    <>
      <HomeScrollBody header={header}>
        <div className="mx-auto max-w-5xl space-y-10 px-16 pb-4">
          <Section
            title="Appearance"
            description="How Screenplay looks on this device."
          >
            <ThemeToggle />
          </Section>

          <Section
            title="Configured repositories"
            description="Saved per-repo setup, dev, port, and env-vars. Applied when you add a workspace inside a canvas."
          >
            <RepoConfigsPanel />
          </Section>
        </div>
      </HomeScrollBody>
    </>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-0.5">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

/**
 * False during SSR and the first client render, true thereafter — without a
 * setState-in-effect. Lets theme-dependent UI render identically on the server
 * and on hydration, then light up once the client knows the real theme.
 */
function useHydrated() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  // next-themes only resolves the active theme on the client; keep the controls
  // unselected until hydrated so the server and first client render agree.
  const mounted = useHydrated()

  return (
    <div className="flex gap-2">
      {THEMES.map(({ value, label, icon: Icon }) => {
        const active = mounted && theme === value
        return (
          <Button
            key={value}
            type="button"
            variant={active ? "default" : "outline"}
            size="sm"
            aria-pressed={active}
            onClick={() => setTheme(value)}
            className={cn(!active && "text-muted-foreground")}
          >
            <Icon className="size-4" />
            {label}
          </Button>
        )
      })}
    </div>
  )
}
