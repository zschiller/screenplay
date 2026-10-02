import { ScribbleIcon } from "@workspace/ui/components/icons"
import type { MockupLayerData } from "@/lib/types"
import type { LayerKindDescriptor } from "./types"

export const mockupLayerKind: LayerKindDescriptor<MockupLayerData> = {
  kind: "mockup-layer",
  pluralLabel: "Mockups",
  singularLabel: "mockup",
  Icon: ScribbleIcon,
  getLabel: (d) => d.title || "Untitled",
}
