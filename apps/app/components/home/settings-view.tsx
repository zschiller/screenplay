"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import {
  type Icon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
} from "@workspace/ui/components/icons"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
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
import { AccountMemoryPanel } from "@/components/memory/account-memory-panel"
import {
  SettingsRow,
  SettingsRowList,
  SettingsRowSkeleton,
} from "./settings-row"

const THEMES: { value: string; label: string; icon: Icon }[] = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
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
  /**
   * The section's body. It gets the section header as a render function, so a
   * section whose action lives in its own state (New repository) can put that
   * action on the title row; the rest render `header()` first as is.
   */
  content: (header: SectionHeader) => React.ReactNode
}

/** Renders the section's title row, with an optional action on its right. */
type SectionHeader = (action?: React.ReactNode) => React.ReactNode

const SECTIONS: SettingsSection[] = [
  {
    id: "general",
    title: "General",
    description: "How Screenplay looks on this device.",
    content: (header) => (
      <>
        {header()}
        <ThemeToggle />
      </>
    ),
  },
  ...(isLocalBuild
    ? [
        {
          id: "coding-agents",
          title: "Agent",
          description:
            "The coding agents that run chats and terminals on this device.",
          content: (header: SectionHeader) => (
            <>
              {header()}
              <DefaultAgentPicker label="Default model" />
              <HarnessSetupPanel />
            </>
          ),
        },
        {
          id: "github",
          title: "GitHub",
          description:
            "Lets Screenplay list your repositories and open pull requests.",
          content: (header: SectionHeader) => (
            <>
              {header()}
              <GitHubConnectionPanel />
            </>
          ),
        },
      ]
    : [
        {
          id: "agent",
          title: "Agent",
          description: "The model new chats start with.",
          content: (header: SectionHeader) => (
            <>
              {header()}
              <DefaultAgentPicker label="Default model" />
            </>
          ),
        },
      ]),
  {
    id: "repositories",
    title: "Repositories",
    description:
      "Your repositories and how each one runs. Every canvas can use them.",
    content: (header) => <RepoConfigsPanel header={header} />,
  },
  {
    id: "memory",
    title: "Memory",
    description: "What every chat you message knows about you, on any canvas.",
    content: (header) => <AccountMemoryPanel header={header} />,
  },
  {
    id: "account",
    title: "Account",
    description: isLocalBuild
      ? "The desktop app runs as you on this device, with no sign-in."
      : "The account you're signed in with.",
    content: (header) => (
      <>
        {header()}
        <AccountPanel />
      </>
    ),
  },
]

/**
 * The Settings page (issue #782): a left nav of sections, one shown at a time,
 * picked by the `section` search param so each has its own URL. An unknown or
 * missing section shows the first.
 */
export function SettingsView({ section }: { section?: string }) {
  // Links made before the rename (#1421) still land on Repositories.
  const id = section === "repository-presets" ? "repositories" : section
  const active = SECTIONS.find((s) => s.id === id) ?? SECTIONS[0]!

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
                  current &&
                    "bg-muted font-medium font-stretch-[98.8%] hover:bg-muted"
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
          {active.content((action) => (
            <div className="space-y-0.5">
              <div className="flex items-center gap-4">
                <h2
                  id="settings-section-title"
                  className="min-w-0 flex-1 font-heading text-title-md leading-7"
                >
                  {active.title}
                </h2>
                {/* Sits on the title's line only, so the description keeps the
                    full width; -my-0.5 keeps the 32px button to the 28px line. */}
                {action && <div className="-my-0.5 shrink-0">{action}</div>}
              </div>
              <p className="text-sm text-muted-foreground">
                {active.description}
              </p>
            </div>
          ))}
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
      <Tabs value={mounted ? (theme ?? "") : ""} onValueChange={setTheme}>
        <TabsList aria-label="Theme">
          {THEMES.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value}>
              <Icon />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
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
