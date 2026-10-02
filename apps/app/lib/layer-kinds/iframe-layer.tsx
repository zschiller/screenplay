import { FrameCornersIcon } from "@workspace/ui/components/icons"
import type { IframeLayerData } from "@/lib/types"
import type { LayerKindDescriptor } from "./types"

export const iframeLayerKind: LayerKindDescriptor<IframeLayerData> = {
  kind: "iframe-layer",
  pluralLabel: "Frames",
  singularLabel: "frame",
  Icon: FrameCornersIcon,
  getLabel: (a) => a.label,
}
