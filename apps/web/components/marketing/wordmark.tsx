import { Mascot } from "./site/mascot"

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2">
      <Mascot size={size} className="mascot-hop" />
      <span className="text-[15px] font-semibold tracking-tight">
        Screenplay
        <span className="text-muted-foreground">.space</span>
      </span>
    </span>
  )
}
