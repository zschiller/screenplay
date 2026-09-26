import { cn } from "@workspace/ui/lib/utils"

/*
 * Three "takes" on the same pricing page — the running prototypes shown inside
 * canvas frames. Pure markup so they read as real UIs at any scale.
 */

export function BoldPricing({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full flex-col bg-[#0B0D12] p-5 text-white",
        className
      )}
    >
      <div className="flex items-center justify-between text-[9px] text-white/50">
        <span className="font-semibold text-white">acme</span>
        <span className="flex gap-3">
          <span>Product</span>
          <span>Pricing</span>
          <span className="rounded-full bg-white px-2 py-0.5 text-black">
            Sign up
          </span>
        </span>
      </div>
      <div className="mt-6 text-[22px] leading-[1.05] font-semibold tracking-tight">
        Pricing that
        <br />
        <span className="bg-gradient-to-r from-[#5EA0FF] to-[#C084FC] bg-clip-text text-transparent">
          scales with you.
        </span>
      </div>
      <div className="mt-5 grid flex-1 grid-cols-3 gap-2">
        {[
          ["Hobby", "$0"],
          ["Pro", "$24"],
          ["Team", "$79"],
        ].map(([name, price], i) => (
          <div
            key={name}
            className={cn(
              "flex flex-col rounded-lg border p-2",
              i === 1
                ? "border-[#5EA0FF] bg-[#106BE3]/20 shadow-[0_0_24px_-6px_#106BE3]"
                : "border-white/10 bg-white/[0.03]"
            )}
          >
            <span className="text-[8px] text-white/60">{name}</span>
            <span className="mt-1 text-[15px] font-semibold">{price}</span>
            <span className="mt-2 space-y-1">
              <span className="block h-1 w-full rounded bg-white/15" />
              <span className="block h-1 w-4/5 rounded bg-white/15" />
              <span className="block h-1 w-3/5 rounded bg-white/15" />
            </span>
            <span
              className={cn(
                "mt-auto rounded py-1 text-center text-[7px] font-medium",
                i === 1 ? "bg-[#106BE3]" : "bg-white/10"
              )}
            >
              Choose
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function MinimalPricing({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full flex-col bg-white p-5 text-zinc-900",
        className
      )}
    >
      <div className="flex items-center justify-between text-[9px] text-zinc-400">
        <span className="font-serif text-[11px] text-zinc-900 italic">
          Acme
        </span>
        <span className="flex gap-3">
          <span>Work</span>
          <span className="text-zinc-900 underline underline-offset-2">
            Pricing
          </span>
        </span>
      </div>
      <div className="mt-6 font-serif text-[20px] leading-tight tracking-tight">
        Simple, honest pricing.
      </div>
      <div className="mt-1 text-[8px] text-zinc-400">
        No seats. No surprises. Cancel anytime.
      </div>
      <div className="mt-4 flex-1 divide-y divide-zinc-200 border-y border-zinc-200">
        {[
          ["Personal", "Free"],
          ["Studio", "$18 /mo"],
          ["Company", "Talk to us"],
        ].map(([name, price], i) => (
          <div
            key={name}
            className="flex items-center justify-between py-2.5 text-[9px]"
          >
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "size-2 rounded-full border",
                  i === 1 ? "border-zinc-900 bg-zinc-900" : "border-zinc-300"
                )}
              />
              {name}
            </span>
            <span className="font-mono text-zinc-500">{price}</span>
          </div>
        ))}
      </div>
      <span className="mt-3 self-start border-b border-zinc-900 text-[8px] font-medium">
        Continue →
      </span>
    </div>
  )
}

export function PlayfulPricing({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative flex h-full flex-col overflow-hidden bg-[#FFE9A8] p-5 text-[#2B1D00]",
        className
      )}
    >
      <div className="absolute -top-6 -right-6 size-20 rounded-full bg-[#FF7A59]" />
      <div className="absolute top-16 -left-4 size-8 rotate-12 rounded-md bg-[#2FCB8F]" />
      <div className="relative flex items-center justify-between text-[9px] font-bold">
        <span>acme ✺</span>
        <span className="rounded-full border-2 border-[#2B1D00] bg-white px-2 py-0.5">
          Try free
        </span>
      </div>
      <div className="relative mt-5 text-[21px] leading-[1] font-black tracking-tight">
        Pick a plan,
        <br />
        any plan!
      </div>
      <div className="relative mt-4 flex flex-1 items-end gap-2">
        {[
          ["Tiny", "$0", "bg-white", "-rotate-3 h-[78%]"],
          ["Mighty", "$20", "bg-[#9B7BFF] text-white", "rotate-2 h-full"],
          ["Mega", "$60", "bg-[#2FCB8F]", "-rotate-1 h-[86%]"],
        ].map(([name, price, color, shape]) => (
          <div
            key={name}
            className={cn(
              "flex flex-1 flex-col rounded-xl border-2 border-[#2B1D00] p-2 shadow-[3px_3px_0_#2B1D00]",
              color,
              shape
            )}
          >
            <span className="text-[8px] font-bold">{name}</span>
            <span className="text-[16px] font-black">{price}</span>
            <span className="mt-auto rounded-full border-2 border-[#2B1D00] bg-[#FFC53D] py-0.5 text-center text-[7px] font-bold text-[#2B1D00]">
              Yes!
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export const branchBadge = {
  red: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  violet:
    "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
  emerald:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
} as const

export function BranchBadge({
  name,
  color,
  className,
}: {
  name: string
  color: keyof typeof branchBadge
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-px font-mono text-[10px] font-medium",
        branchBadge[color],
        className
      )}
    >
      {name}
    </span>
  )
}

/** The twinkling 3×3 dot spinner the app shows on a Workspace while its agent runs. */
export function GripSpinner({ className }: { className?: string }) {
  return (
    <span className={cn("grid grid-cols-3 gap-[1.5px]", className)} aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          className="grip-dot size-[2.5px] rounded-full bg-current"
          style={{ animationDelay: `${(i * 137) % 900}ms` }}
        />
      ))}
    </span>
  )
}
