import { FileText } from "lucide-react"
import type { DocumentLayerData } from "@/lib/types"
import type { LayerKindDescriptor } from "./types"

export const documentKind: LayerKindDescriptor<DocumentLayerData> = {
  kind: "document",
  pluralLabel: "Documents",
  singularLabel: "document",
  Icon: FileText,
  getLabel: (d) => d.title || "Untitled",
  canBeChatTarget: true,
}
