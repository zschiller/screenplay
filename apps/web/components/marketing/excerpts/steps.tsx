import {
  ArrowSquareOutIcon,
  BookBookmarkIcon,
  CaretDownIcon,
  ClipboardTextIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  MagnifyingGlassIcon,
  PathIcon,
  PlayIcon,
  TrashIcon,
  XIcon,
} from "@workspace/ui/components/icons"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

import { Frame, WorkspaceRow } from "./canvas"
import { Fit } from "./fit"
import { Northwind } from "./northwind"

/*
 * The "How it works" steps' excerpts: one piece of the app per step, laid out
 * at the app's real size in a 320×256 card and scaled to the column.
 */

function Card({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <Fit
      width={320}
      height={256}
      role="img"
      aria-label={label}
      className={cn("bg-plane border border-border text-foreground", className)}
    >
      <div className="[container-type:inline-size] relative size-full">
        {children}
      </div>
    </Fit>
  )
}

/** A popover or dialog surface, as the app draws one. */
const surface =
  "rounded-lg bg-popover text-popover-foreground shadow-md outline outline-1 outline-foreground/10"

const repos = [
  ["acme/northwind-web", "2 hours ago"],
  ["acme/northwind-docs", "Yesterday"],
  ["acme/api", "3 days ago"],
] as const

/** Step 1: picking the repository, and its first Workspace starting up. */
export function AddRepoExcerpt() {
  return (
    <Card label="Picking a repository to add; its Main Workspace installs dependencies.">
      <div
        className={cn(
          surface,
          "absolute top-5 left-5 flex w-[280px] flex-col gap-0.5 p-1 text-[13px]"
        )}
      >
        <div className="flex h-8 items-center gap-2 border-b border-border px-2 text-muted-foreground">
          <MagnifyingGlassIcon className="size-3.5" />
          northwind
        </div>
        {repos.map(([name, when], i) => (
          <div
            key={name}
            className={cn(
              "flex h-8 items-center gap-2 rounded-md px-2",
              i === 0 && "bg-accent"
            )}
          >
            <BookBookmarkIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{name}</span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {when}
            </span>
          </div>
        ))}
      </div>
      <div
        className={cn(
          surface,
          "absolute top-[180px] left-5 flex w-[280px] items-center gap-2 px-3 py-2 text-[13px]"
        )}
      >
        <Spinner className="size-3" aria-hidden />
        <span className="font-medium">Main</span>
        <span className="truncate text-muted-foreground">
          Installing dependencies · 12s
        </span>
      </div>
    </Card>
  )
}

function PromptBox({ prompt }: { prompt: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="flex items-center gap-1 font-mono text-[11px] text-foreground">
          <GitBranchIcon className="size-3" />
          main
          <CaretDownIcon className="size-2.5 text-muted-foreground" />
        </span>
        <TrashIcon className="size-3" />
      </div>
      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-background px-2.5 py-2">
        <span className="line-clamp-1">{prompt}</span>
        <span className="flex items-center gap-3 text-[11px] whitespace-nowrap">
          <span className="flex items-center gap-1">
            Claude Code · Opus
            <CaretDownIcon className="size-2.5 text-muted-foreground" />
          </span>
          <span className="flex items-center gap-1">
            <ClipboardTextIcon className="size-3" />
            Plan
          </span>
        </span>
      </div>
    </div>
  )
}

/** Step 2: the Create workspaces dialog, two prompts at once. */
export function CreateWorkspacesExcerpt() {
  return (
    <Card label="The Create workspaces dialog, with a prompt for each of two new Workspaces.">
      <div
        className={cn(
          surface,
          "absolute top-3 left-4 flex w-[288px] flex-col gap-2.5 p-3 text-xs"
        )}
      >
        <div className="flex items-start justify-between">
          <span className="font-heading text-xl leading-none">
            Create workspaces
          </span>
          <XIcon className="size-3.5 text-muted-foreground" />
        </div>
        <PromptBox prompt="Add a monthly/annual toggle with 20% off annual plans" />
        <PromptBox prompt="Redesign the customer quotes as a carousel" />
        <div className="flex justify-end">
          <span className="flex h-7 items-center rounded-md bg-primary px-3 text-primary-foreground">
            Create 2 workspaces
          </span>
        </div>
      </div>
    </Card>
  )
}

/** Step 3: two Workspaces' builds of the same page, side by side. */
export function CompareExcerpt() {
  return (
    <Card label="Two Workspaces' versions of the Northwind homepage running side by side, desktop and mobile.">
      <Frame
        label="Home"
        group={["Homepage", "Hero gradient"]}
        selected
        style={{ left: 16, top: 52, width: 180 }}
      >
        <Northwind version="gradient" />
      </Frame>
      <Frame
        label="Mobile"
        device="mobile"
        style={{ left: 208, top: 52, width: 52 }}
      >
        <Northwind device="mobile" version="gradient" />
      </Frame>
      <Frame
        label="Home"
        group={["Homepage", "Main"]}
        style={{ left: 16, top: 204, width: 180 }}
      >
        <Northwind />
      </Frame>
      <Frame
        label="Mobile"
        device="mobile"
        style={{ left: 208, top: 204, width: 52 }}
      >
        <Northwind device="mobile" />
      </Frame>
    </Card>
  )
}

const menu: (
  | { icon: React.ReactNode; label: string; on?: boolean }
  | "separator"
)[] = [
  { icon: <GitPullRequestIcon />, label: "Create pull request", on: true },
  "separator",
  { icon: <PlayIcon />, label: "Open prototype player" },
  { icon: <ArrowSquareOutIcon />, label: "Open in browser" },
  { icon: <PathIcon />, label: "Show all routes" },
]

/** Step 4: a Workspace's menu, with Create pull request on top. */
export function PullRequestExcerpt() {
  return (
    <Card
      label="A Workspace's menu in the sidebar, with Create pull request at the top."
      className="bg-sidebar"
    >
      <div className="absolute top-5 left-3 flex w-[232px] flex-col gap-0.5">
        <WorkspaceRow name="Customer stories" />
        <WorkspaceRow name="Hero gradient & trust line" selected menu />
        <WorkspaceRow name="Pricing FAQ" diff={[11, 0]} />
      </div>
      <div
        className={cn(
          surface,
          "absolute top-[88px] left-[108px] flex w-[200px] flex-col p-1 text-[13px]"
        )}
      >
        {menu.map((item, i) =>
          item === "separator" ? (
            <div key={i} className="-mx-1 my-1 h-px bg-border" />
          ) : (
            <div
              key={item.label}
              className={cn(
                "flex h-8 items-center gap-2 rounded-md px-2 whitespace-nowrap [&_svg]:size-3.5 [&_svg]:shrink-0",
                item.on && "bg-accent"
              )}
            >
              {item.icon}
              {item.label}
            </div>
          )
        )}
      </div>
    </Card>
  )
}
