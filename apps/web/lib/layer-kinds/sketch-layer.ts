import { Frame } from "lucide-react"
import type { SketchLayerData } from "@/lib/types"
import type { LayerKindDescriptor } from "./types"

export const sketchLayerKind: LayerKindDescriptor<SketchLayerData> = {
  kind: "sketch-layer",
  pluralLabel: "Sketches",
  singularLabel: "sketch",
  Icon: Frame,
  getLabel: (s) => s.title || "Untitled",
  canBeChatTarget: true,
}
