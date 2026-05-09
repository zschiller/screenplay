import { FileText } from "lucide-react"
import type { MarkdownLayerData } from "@/lib/types"
import type { LayerKindDescriptor } from "./types"

export const markdownLayerKind: LayerKindDescriptor<MarkdownLayerData> = {
  kind: "markdown-layer",
  pluralLabel: "Documents",
  singularLabel: "document",
  Icon: FileText,
  getLabel: (d) => d.title || "Untitled",
  canBeChatTarget: true,
}
