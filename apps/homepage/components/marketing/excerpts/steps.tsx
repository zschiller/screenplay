import {
  ArrowSquareOutIcon,
  BookBookmarkIcon,
  ChatsIcon,
  CheckIcon,
  GitPullRequestIcon,
  MagnifyingGlassIcon,
  PathIcon,
  PlayIcon,
} from "@workspace/ui/components/icons"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

import {
  ChatCard,
  Frame,
  UserBubble,
  WorkspaceRow,
  ask,
  versions,
} from "./canvas"
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
    <Card label="Picking a repository to add; its first Workspace installs dependencies.">
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
          "absolute top-[180px] left-5 flex w-[280px] items-center gap-2 px-3 py-2 text-xs"
        )}
      >
        <Spinner className="size-3" aria-hidden />
        <span className="shrink-0 font-medium">New Workspace</span>
        <span className="truncate text-muted-foreground">
          Installing dependencies
        </span>
      </div>
    </Card>
  )
}

/**
 * Step 2: the ask, and the Workspaces the Coordinator started for it right
 * away, each a chat card with what it was asked.
 */
export function CreateWorkspacesExcerpt() {
  return (
    <Card label="The ask in the Coordinator's chat, and a chat card for each of the three Workspaces it started, all working.">
      <div className="absolute inset-x-4 top-4 flex flex-col gap-3 text-[13px] leading-normal">
        <UserBubble className="ml-0 text-xs">{ask}</UserBubble>
        <p className="text-xs">Starting a Workspace for each version.</p>
        <div className="flex flex-col gap-1">
          {versions.map((v) => (
            <ChatCard
              key={v.title}
              title={v.title}
              prompt={v.prompt}
              diff={v.diff}
              working
            />
          ))}
        </div>
      </div>
    </Card>
  )
}

/**
 * Step 3: two of the versions of the same page, side by side. Each version is
 * a Group of its desktop and mobile frames, so its title names the Workspace
 * once for both.
 */
export function CompareExcerpt() {
  const [split, dark] = [versions[1], versions[2]]
  return (
    <Card label="Two versions of the Northwind homepage hero running side by side, desktop and mobile.">
      <Frame
        label="Home"
        group={["Homepage", split.title]}
        selected
        style={{ left: 16, top: 46, width: 180 }}
      >
        <Northwind version={split.version} />
      </Frame>
      <Frame
        label="Mobile"
        device="mobile"
        style={{ left: 208, top: 46, width: 52 }}
      >
        <Northwind device="mobile" version={split.version} />
      </Frame>
      <Frame
        label="Home"
        group={["Homepage", dark.title]}
        style={{ left: 16, top: 212, width: 180 }}
      >
        <Northwind version={dark.version} />
      </Frame>
      <Frame
        label="Mobile"
        device="mobile"
        style={{ left: 208, top: 212, width: 52 }}
      >
        <Northwind device="mobile" version={dark.version} />
      </Frame>
    </Card>
  )
}

const menu: (
  { icon: React.ReactNode; label: string; on?: boolean } | "separator"
)[] = [
  { icon: <GitPullRequestIcon />, label: "Create pull request", on: true },
  "separator",
  { icon: <PlayIcon />, label: "Open prototype player" },
  { icon: <ArrowSquareOutIcon />, label: "Open in browser" },
  { icon: <PathIcon />, label: "Show all routes" },
]

/**
 * Step 4: the Chats menu, with the picked version's Workspace menu open on
 * Create pull request, which leads it once the Workspace has changes.
 */
export function PullRequestExcerpt() {
  return (
    <Card label="The Chats menu listing the Coordinator and the three versions, with the picked one's menu open on Create pull request.">
      <div
        className={cn(
          surface,
          // Cropped below its search field, so the open menu fits.
          "absolute top-[-37px] left-3 flex w-[236px] flex-col text-sm"
        )}
      >
        <div className="flex h-9 items-center gap-2 border-b border-border px-3 text-muted-foreground">
          <MagnifyingGlassIcon className="size-4" />
          Search chats…
        </div>
        <div className="flex flex-col gap-0.5 p-1">
          <div className="flex h-8 items-center gap-2 px-2">
            <span className="flex size-4 shrink-0 items-center justify-center">
              <ChatsIcon className="size-3.5 opacity-70" />
            </span>
            Coordinator
            <CheckIcon className="ml-auto size-3.5 opacity-0" />
          </div>
          <span className="px-2 pt-1.5 pb-1 font-mono text-xs tracking-wider text-muted-foreground uppercase">
            Chats
          </span>
          {versions.map((v) => (
            <WorkspaceRow
              key={v.title}
              name={v.title}
              diff={v.version === "split" ? undefined : v.diff}
              selected={v.version === "split"}
              menu={v.version === "split"}
            />
          ))}
        </div>
      </div>
      <div
        className={cn(
          surface,
          // Menus take the other theme in the app (`inverted`, #1073).
          "inverted absolute top-[100px] left-[128px] flex w-[200px] flex-col p-1 text-[13px]"
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
