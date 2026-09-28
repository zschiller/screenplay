"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"
import { cn } from "@workspace/ui/lib/utils"
import { signOut, useAppSession } from "@/lib/auth-client"
import { getTauriInvoke } from "@/lib/desktop/tauri-bridge"
import { isLocalBuild } from "@/lib/local-mode"
import { HomeScrollBody } from "./home-scroll-body"
import { HOME_COLUMN, HomePageHeader } from "./home-page-header"
import { GitHubConnectionPanel } from "./github-connection-panel"
import { HarnessSetupPanel } from "./harness-setup-panel"
import { DefaultAgentPicker } from "./default-agent-picker"
import { RepoConfigsPanel } from "./repo-configs-panel"
import {
  SettingsRow,
  SettingsRowList,
  SettingsRowSkeleton,
} from "./settings-row"

const THEMES: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
]

/**
 * A Settings section: one entry in the left nav, one screen of the page. The
 * desktop build adds the host-side sections (coding agents, GitHub); the hosted
 * build has an Agent section for its default model instead.
 */
interface SettingsSection {
  id: string
  title: string
  description: string
  content: () => React.ReactNode
}

const SECTIONS: SettingsSection[] = [
  {
    id: "general",
    title: "General",
    description: "How Screenplay looks on this device.",
    content: () => <ThemeToggle />,
  },
  ...(isLocalBuild
    ? [
        {
          id: "coding-agents",
          title: "Coding agents",
          description: "The CLIs that back chats and terminals on this device.",
          content: () => (
            <>
              <DefaultAgentPicker label="Default agent" />
              <HarnessSetupPanel />
            </>
          ),
        },
        {
          id: "github",
          title: "GitHub",
          description: "How Screenplay reaches the GitHub API on this device.",
          content: () => <GitHubConnectionPanel />,
        },
      ]
    : [
        {
          id: "agent",
          title: "Agent",
          description: "The model new chats and Workspaces start with.",
          content: () => <DefaultAgentPicker label="Default model" />,
        },
      ]),
  {
    id: "repository-presets",
    title: "Repository presets",
    description:
      "Saved setup, dev, port, and env vars for each repository. Applied when you add it to a canvas.",
    content: () => <RepoConfigsPanel />,
  },
  {
    id: "account",
    title: "Account",
    description: isLocalBuild
      ? "The desktop app runs as you on this device, with no sign-in."
      : "The account you're signed in with.",
    content: () => <AccountPanel />,
  },
]

/**
 * The Settings page (issue #782): a left nav of sections, one shown at a time,
 * picked by the `section` search param so each has its own URL. An unknown or
 * missing section shows the first.
 */
export function SettingsView({ section }: { section?: string }) {
  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]!

  return (
    <HomeScrollBody header={<HomePageHeader title="Settings" />}>
      <div
        className={cn(
          HOME_COLUMN,
          "grid gap-6 pb-4 @2xl/home:grid-cols-[10rem_minmax(0,1fr)] @2xl/home:gap-10"
        )}
      >
        <nav
          aria-label="Settings"
          className="-mx-2.5 flex flex-wrap gap-1 @2xl/home:mx-0 @2xl/home:-ml-2.5 @2xl/home:flex-col @2xl/home:self-start"
        >
          {SECTIONS.map((s) => {
            const current = s.id === active.id
            return (
              <Link
                key={s.id}
                href={`/settings?section=${s.id}`}
                aria-current={current ? "page" : undefined}
                className={cn(
                  buttonVariants({ variant: "ghost" }),
                  "justify-start font-normal",
                  current && "bg-muted font-medium hover:bg-muted"
                )}
              >
                {s.title}
              </Link>
            )
          })}
        </nav>

        <section
          aria-labelledby="settings-section-title"
          className="min-w-0 space-y-5"
        >
          <div className="space-y-0.5">
            <h2
              id="settings-section-title"
              className="text-lg font-semibold tracking-tight"
            >
              {active.title}
            </h2>
            <p className="text-sm text-muted-foreground">
              {active.description}
            </p>
          </div>
          {active.content()}
        </section>
      </div>
    </HomeScrollBody>
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
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-sm">Theme</span>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-label="Theme"
        value={mounted ? (theme ?? "") : ""}
        // Radix clears the value when the pressed item is clicked again; a
        // theme is always set, so ignore that.
        onValueChange={(value) => value && setTheme(value)}
      >
        {THEMES.map(({ value, label, icon: Icon }) => (
          <ToggleGroupItem
            key={value}
            value={value}
            className="text-muted-foreground"
          >
            <Icon />
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

/**
 * The Account section. Hosted: who you're signed in as, with Sign out. The
 * desktop build has no login (PRD #404), so there it's the app itself and its
 * version, read from the desktop shell.
 */
function AccountPanel() {
  const { data: session, isPending } = useAppSession()
  const router = useRouter()
  const version = useDesktopVersion()

  if (isLocalBuild) {
    return (
      <SettingsRowList>
        <SettingsRow
          title="Screenplay"
          detail={version ? `Version ${version}` : "Desktop app"}
        />
      </SettingsRowList>
    )
  }

  if (isPending) return <SettingsRowSkeleton label="Loading your account…" />

  const user = session?.user
  const name = user?.name ?? "Account"

  return (
    <SettingsRowList>
      <SettingsRow
        media={
          <Avatar className="size-8">
            <AvatarImage src={user?.image ?? undefined} alt="" />
            <AvatarFallback className="text-xs">
              {(name[0] ?? "?").toUpperCase()}
            </AvatarFallback>
          </Avatar>
        }
        title={name}
        detail={user?.email}
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={async () => {
              await signOut()
              router.push("/sign-in")
            }}
          >
            Sign out
          </Button>
        }
      />
    </SettingsRowList>
  )
}

/** The desktop shell's app version (Tauri's `app` plugin), or null outside it. */
function useDesktopVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    const invoke = getTauriInvoke()
    if (!invoke) return
    let cancelled = false
    invoke("plugin:app|version")
      .then((v) => {
        if (!cancelled && typeof v === "string") setVersion(v)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return version
}
