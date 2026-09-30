import { PaletteIcon } from "@workspace/ui/components/icons"
import type { MockupLayerData } from "@/lib/types"
import type { LayerKindDescriptor } from "./types"

export const mockupLayerKind: LayerKindDescriptor<MockupLayerData> = {
  kind: "mockup-layer",
  pluralLabel: "Mockups",
  singularLabel: "mockup",
  Icon: PaletteIcon,
  getLabel: (d) => d.title || "Untitled",
  // A mockup is a picture of an idea; building it goes through its Workspace.
  canBeChatTarget: false,
}
