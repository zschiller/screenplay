import { Frame } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import type { ArtboardData } from "@/lib/types"
import type { LayerKindDescriptor } from "./types"

export const artboardKind: LayerKindDescriptor<ArtboardData> = {
  kind: "artboard",
  pluralLabel: "Frames",
  singularLabel: "frame",
  Icon: Frame,
  getLabel: (a) => a.label,
  // Artboards are sandbox-backed; their chat is run by the agent flow on
  // the agent record, not the artboard itself, so they aren't a chat target.
  canBeChatTarget: false,
  renderRowAccessory: (a) => (
    <Badge
      variant="outline"
      className="max-w-[6rem] shrink-0 border-transparent bg-sidebar-accent font-mono text-[10px] text-sidebar-foreground/60 py-0 px-1.5"
    >
      <span className="truncate">{a.route || "/"}</span>
    </Badge>
  ),
}
