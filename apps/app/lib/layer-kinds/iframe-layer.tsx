import { FrameCornersIcon } from "@workspace/ui/components/icons"
import type { IframeLayerData } from "@/lib/types"
import type { LayerKindDescriptor } from "./types"

export const iframeLayerKind: LayerKindDescriptor<IframeLayerData> = {
  kind: "iframe-layer",
  pluralLabel: "Frames",
  singularLabel: "frame",
  Icon: FrameCornersIcon,
  getLabel: (a) => a.label,
  // Iframe layers are sandbox-backed; their chat is run by the agent flow on
  // the agent record, not the layer itself, so they aren't a chat target.
  canBeChatTarget: false,
}
