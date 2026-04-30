export function CodeBlock({
  filename,
  children,
}: {
  filename?: string
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {filename ? (
        <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2">
          <span className="size-2.5 rounded-full bg-muted-foreground/20" />
          <span className="size-2.5 rounded-full bg-muted-foreground/20" />
          <span className="size-2.5 rounded-full bg-muted-foreground/20" />
          <span className="ml-2 font-mono text-xs text-muted-foreground">
            {filename}
          </span>
        </div>
      ) : null}
      <pre className="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-relaxed text-foreground">
        <code>{children}</code>
      </pre>
    </div>
  )
}

// Token color helpers — kept tasteful in light + dark via OKLch-friendly hexes.
export const tok = {
  keyword: "text-[#A06CD5] dark:text-[#C58FFF]",
  string: "text-[#0C8E5E] dark:text-[#7DD3A7]",
  fn: "text-[#106BE3] dark:text-[#7DAEFF]",
  comment: "text-muted-foreground italic",
  prop: "text-[#B0651E] dark:text-[#F2A06A]",
  number: "text-[#B0651E] dark:text-[#F2A06A]",
  punct: "text-foreground/70",
} as const
