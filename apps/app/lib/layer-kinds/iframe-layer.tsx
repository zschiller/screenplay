import { Frame } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import type { IframeLayerData } from "@/lib/types"
import type { LayerKindDescriptor } from "./types"

export const iframeLayerKind: LayerKindDescriptor<IframeLayerData> = {
  kind: "iframe-layer",
  pluralLabel: "Frames",
  singularLabel: "frame",
  Icon: Frame,
  getLabel: (a) => a.label,
  // Iframe layers are sandbox-backed; their chat is run by the agent flow on
  // the agent record, not the layer itself, so they aren't a chat target.
  canBeChatTarget: false,
  renderRowAccessory: (a) => (
    <Badge
      variant="outline"
      className="max-w-[6rem] shrink-0 border-transparent bg-sidebar-accent px-1.5 py-0 font-mono text-[10px] text-sidebar-foreground/60"
    >
      <span className="truncate">{a.route || "/"}</span>
    </Badge>
  ),
}
