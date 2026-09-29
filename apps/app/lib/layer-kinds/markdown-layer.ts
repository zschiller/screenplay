import { FileTextIcon } from "@workspace/ui/components/icons"
import type { MarkdownLayerData } from "@/lib/types"
import type { LayerKindDescriptor } from "./types"

export const markdownLayerKind: LayerKindDescriptor<MarkdownLayerData> = {
  kind: "markdown-layer",
  pluralLabel: "Documents",
  singularLabel: "document",
  Icon: FileTextIcon,
  getLabel: (d) => d.title || "Untitled",
  canBeChatTarget: true,
}
