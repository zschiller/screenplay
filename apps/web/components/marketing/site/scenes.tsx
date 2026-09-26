import {
  ArrowUp,
  FolderPlus,
  GitBranch,
  GitPullRequest,
  Plus,
} from "lucide-react"
import { BranchBadge, GripSpinner } from "./variants"
import { SectionHeading } from "./section-heading"

const scenes = [
  {
    slug: "Scene 1",
    title: "Point it at a repo",
    body: "Add a project and Screenplay boots its dev server in a sandbox. That's your main workspace, live on the canvas.",
    Visual: RepoVisual,
  },
  {
    slug: "Scene 2",
    title: "Call for takes",
    body: "Ask your agent for three directions. Each gets its own workspace — a real git branch with its own running sandbox.",
    Visual: PromptVisual,
  },
  {
    slug: "Scene 3",
    title: "Watch them all run",
    body: "Frames appear side by side as they build. Click through them, resize to mobile, tweak knobs. Invite the team to poke around.",
    Visual: FramesVisual,
  },
  {
    slug: "Scene 4",
    title: "Print the winner",
    body: "Keep iterating on the one you love, then open a pull request straight from the chat panel. Cut the rest.",
    Visual: PrVisual,
  },
]

export function Scenes() {
  return (
    <section
      id="how"
      className="scroll-mt-20 border-y border-border/60 bg-muted/30"
    >
      <div className="mx-auto w-full max-w-6xl px-5 py-24 sm:px-8 sm:py-32">
        <SectionHeading
          slug="Ext. The canvas — day"
          title="From one prompt to a wall of working prototypes."
          body="Screenplay turns “what if we tried…” into something everyone can click, in about the time it takes to refill your coffee."
        />
        <ol className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {scenes.map(({ slug, title, body, Visual }) => (
            <li
              key={slug}
              className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex h-44 items-center justify-center border-b border-border/70 bg-muted/40 [background-image:radial-gradient(var(--dot)_1px,transparent_1px)] [background-size:14px_14px] p-5">
                <Visual />
              </div>
              <div className="flex flex-col p-5">
                <span className="font-screenplay text-xs tracking-wide text-muted-foreground uppercase">
                  {slug}
                </span>
                <h3 className="mt-2 text-lg font-semibold tracking-tight">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-[220px] rounded-xl bg-background p-2 text-[11px] shadow-md ring-1 ring-foreground/5 transition-transform duration-300 group-hover:-translate-y-1">
      {children}
    </div>
  )
}

function RepoVisual() {
  return (
    <Pill>
      <div className="flex items-center justify-between px-1.5 pb-1.5 text-[10px] font-medium text-muted-foreground">
        Projects <FolderPlus className="size-3" />
      </div>
      <div className="flex items-center gap-2 rounded-md px-1.5 py-1 font-medium">
        <span className="grid size-4 place-items-center rounded bg-foreground text-[8px] font-bold text-background">
          a
        </span>
        acme-web
      </div>
      <div className="ml-3 border-l border-border pl-2">
        <div className="flex items-center gap-1.5 rounded-md bg-muted px-1.5 py-1">
          <GitBranch className="size-3 text-muted-foreground" />
          <BranchBadge name="main" color="emerald" />
          <span className="ml-auto flex items-center gap-1 text-[9px] text-emerald-600">
            <span className="size-1.5 rounded-full bg-emerald-500" /> live
          </span>
        </div>
      </div>
    </Pill>
  )
}

function PromptVisual() {
  return (
    <Pill>
      <div className="px-1 pt-0.5 pb-3 leading-snug">
        Try three takes on the pricing page
        <span className="caret-blink ml-px inline-block h-3 w-px translate-y-0.5 bg-foreground" />
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="rounded border border-border px-1">Plan</span>
        <span>Opus 4.8</span>
        <span className="ml-auto grid size-5 place-items-center rounded-full bg-foreground text-background">
          <ArrowUp className="size-3" />
        </span>
      </div>
    </Pill>
  )
}

function FramesVisual() {
  return (
    <div className="flex items-end gap-2 transition-transform duration-300 group-hover:-translate-y-1">
      {(
        [
          ["red", "bg-[#0B0D12]"],
          ["sky", "bg-white"],
          ["amber", "bg-[#FFE9A8]"],
        ] as const
      ).map(([color, bg], i) => (
        <div key={color} className="flex flex-col gap-1">
          <span className="flex items-center gap-1">
            <BranchBadge
              name={`take-${i + 1}`}
              color={color}
              className="text-[8px]"
            />
            <GripSpinner className="text-muted-foreground" />
          </span>
          <span
            className={`block h-20 w-14 rounded-sm shadow-sm ring-1 ring-black/10 ${bg}`}
          >
            <span className="m-2 block h-1.5 w-6 rounded bg-current opacity-20" />
            <span className="mx-2 block h-1 w-8 rounded bg-current opacity-10" />
          </span>
        </div>
      ))}
    </div>
  )
}

function PrVisual() {
  return (
    <Pill>
      <div className="flex items-center gap-2 p-1">
        <GitPullRequest className="size-4 text-emerald-600" />
        <div className="min-w-0">
          <div className="truncate font-medium">Playful pricing page</div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            #128 ·{" "}
            <BranchBadge
              name="pricing-playful"
              color="amber"
              className="text-[8px]"
            />
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
        Ready to merge
        <span className="font-mono">
          +184 <span className="text-red-500">−37</span>
        </span>
      </div>
      <div className="mt-1 flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
        <Plus className="size-3 rotate-45" /> 2 other takes archived
      </div>
    </Pill>
  )
}
