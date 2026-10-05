"use client"

import {
  SidebarMenuButton,
  SidebarMenuSubButton,
} from "@workspace/ui/components/sidebar"
import {
  EditableText,
  editableTextFieldClass,
} from "@workspace/ui/components/editable-text"
import { cn } from "@workspace/ui/lib/utils"
import { LayerMenu } from "@/components/canvas/layer-menu"
import { markdownLayerKind } from "@/lib/layer-kinds/markdown-layer"
import { mockupLayerKind } from "@/lib/layer-kinds/mockup-layer"
import type { LayerKindDescriptor } from "@/lib/layer-kinds/types"
import { renameOnF2 } from "./rename-key"
import { frameRowActionClass, frameRowButtonClass } from "./row-action"
import type {
  LayerRowComponents,
  LayerRowMenuProps,
  LayerRowProps,
} from "./types"

/** The record shape a titled row reads: an id and a title. */
type TitledLayer = { id: string; title: string }

/**
 * The sidebar row and menu for a Layer named by a `title` (Documents and
 * Mockups): its icon, an inline-rename name, and the Layer's menu.
 */
function makeTitledLayerRow<T extends TitledLayer>(
  descriptor: LayerKindDescriptor<T>
): LayerRowComponents<T> {
  function Row(props: LayerRowProps<T>) {
    return <TitledLayerRow descriptor={descriptor} {...props} />
  }
  function Menu(props: LayerRowMenuProps<T>) {
    return <TitledLayerRowMenu descriptor={descriptor} {...props} />
  }
  return { kind: descriptor.kind, Row, Menu }
}

export const documentRow = makeTitledLayerRow(markdownLayerKind)
export const mockupRow = makeTitledLayerRow(mockupLayerKind)

function TitledLayerRow<T extends TitledLayer>({
  descriptor,
  item,
  variant,
  selected,
  onSelect,
  onActivate,
  onRename,
  editableRef,
}: LayerRowProps<T> & { descriptor: LayerKindDescriptor<T> }) {
  const Icon = descriptor.Icon
  const label = descriptor.getLabel(item)

  const nameEditable = (
    <EditableText
      ref={editableRef}
      as="span"
      value={label}
      onCommit={(next) => onRename(item.id, next)}
      placeholder="Untitled"
      tabIndex={-1}
      className="min-w-0"
      viewClassName="truncate"
      editClassName={cn(
        editableTextFieldClass,
        "-mx-0.5 -my-0.5 min-w-0 px-0.5 py-0.5"
      )}
    />
  )

  if (variant === "flat") {
    return (
      <SidebarMenuButton
        className={cn(
          "w-full !transition-[width,height] has-[[data-editable-text=editing]]:overflow-visible",
          frameRowButtonClass
        )}
        isActive={selected}
        onClick={(e) => {
          e.stopPropagation()
          onSelect(item.id, e.shiftKey)
        }}
        onKeyDown={(e) => renameOnF2(e, editableRef)}
        onDoubleClick={(e) => {
          e.stopPropagation()
          onActivate?.(item.id)
        }}
      >
        <Icon className="shrink-0 text-sidebar-foreground/70" />
        {nameEditable}
      </SidebarMenuButton>
    )
  }
  return (
    <SidebarMenuSubButton asChild isActive={selected}>
      <button
        type="button"
        className={cn(
          "w-full cursor-pointer !transition-[width,height] has-[[data-editable-text=editing]]:overflow-visible",
          frameRowButtonClass
        )}
        onClick={(e) => {
          e.stopPropagation()
          onSelect(item.id, e.shiftKey)
        }}
        onKeyDown={(e) => renameOnF2(e, editableRef)}
        onDoubleClick={(e) => {
          e.stopPropagation()
          onActivate?.(item.id)
        }}
      >
        <Icon className="shrink-0 text-sidebar-foreground/70" />
        {nameEditable}
      </button>
    </SidebarMenuSubButton>
  )
}

function TitledLayerRowMenu<T extends TitledLayer>({
  descriptor,
  item,
  isSub,
  onRemove,
  editableRef,
}: LayerRowMenuProps<T> & { descriptor: LayerKindDescriptor<T> }) {
  const noun = descriptor.singularLabel as "document" | "mockup"
  // The Layer's one menu (I7), the same as its canvas …: each publishes its
  // own (a Mockup's has Duplicate); Rename and Delete stand in until it has.
  return (
    <LayerMenu
      placement="row"
      layerId={item.id}
      actions={{ noun, onDelete: () => onRemove(item.id) }}
      onRename={() => editableRef?.current?.startEditing()}
      className={cn(frameRowActionClass, isSub && "!top-1/2 -translate-y-1/2")}
    />
  )
}
