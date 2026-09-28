import { Frame } from "lucide-react"
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
  // The route is muted text that only takes the width the frame's name
  // leaves over (#793). A zero flex basis lays the name out first; the route
  // then shows whole or not at all: when it doesn't fit it wraps onto a second
  // line (past a zero-width, full-height spacer) that the one-line box clips,
  // rather than truncating into a fragment that reads as a different route.
  renderRowAccessory: (a) => (
    <span className="flex h-4 min-w-0 flex-1 basis-0 flex-wrap justify-end overflow-hidden before:h-4 before:w-0 before:content-['']">
      <span className="font-mono text-[11px] leading-4 whitespace-nowrap text-sidebar-foreground/60">
        {a.route || "/"}
      </span>
    </span>
  ),
}
