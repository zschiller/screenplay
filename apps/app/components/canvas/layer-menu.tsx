"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react"
import {
  ArrowsOutSimpleIcon,
  AppWindowIcon,
  ChatCircleIcon,
  CopyIcon,
  DotsThreeIcon,
  FilePlusIcon,
  MinusSquareIcon,
  PencilSimpleIcon,
  PlayIcon,
  TrashIcon,
} from "@workspace/ui/components/icons"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { FloatingToolbarButton } from "@workspace/ui/components/floating-toolbar"
import { IconButton } from "@workspace/ui/components/icon-button"
import { SidebarMenuAction } from "@workspace/ui/components/sidebar"
import { cn } from "@workspace/ui/lib/utils"
import { StableProps } from "@/lib/canvas/stable-props"
import { useChatsMenu } from "@/components/agent/chats-menu"
import {
  WorkspaceMenuItems,
  useHasWorkspaceMenu,
} from "@/components/agent/workspace-menu"
import { MenuKeys } from "@/components/menu-keys"
import { OpenInBrowserItem } from "@/components/open-in-browser-item"
import { useFocusNeighbourOnDelete } from "@/components/panels/layer-rows/row-focus"
import { DUPLICATE_KEYS } from "@/lib/canvas/shortcuts"
import { DeviceSizeSubMenu } from "./device-size-menu"
import {
  MoveToPageContext,
  MoveToPageSubMenu,
  type MoveToPageTarget,
} from "./move-to-page"
import { useViewing } from "@/lib/viewer/context"

/**
 * One menu per object (I7): a frame, mockup, document or Group has one menu,
 * and the sidebar row's … and the canvas's … (the toolbar's, or the label's
 * for a document or Group) both render it through {@link LayerMenu}, so the
 * two can't drift.
 *
 * The items, in order, each shown when the object has it: Rename, Duplicate,
 * Duplicate as new file, Move to page, then the frame's Device size, Fit to
 * content, Preview and Chat, then Delete (Remove from canvas and Delete file for a
 * Document's or Mockup's view, #1884).
 */
export interface LayerMenuActions {
  /** The object, for the trigger's name ("Frame options"). */
  noun: "frame" | "mockup" | "document" | "group"
  onDuplicate?: () => void
  /** A Document's or Mockup's view: copy its file into a new one (#1884). */
  onDuplicateAsNewFile?: () => void
  /** What Move to page ▸ moves: the Layer alone, or the whole Group. */
  moveTo?: MoveToPageTarget
  size?: {
    width: number
    height: number
    onSelect: (width: number, height: number) => void
  }
  /** Fit to content, a toggle: on, the height follows the page's content. */
  fitToContent?: {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
  }
  /**
   * The frame's chat's menu (H4), split in two: Preview (what acts on the
   * running app the frame shows) and Chat (what acts on the chat itself).
   */
  chat?: {
    branchId: string | null | undefined
    onPlay?: () => void
    onOpenInBrowser?: () => void
    /** Open logs: the chat's Preview terminal. */
    onOpenLogs?: () => void
  }
  /**
   * Delete, when the object can be removed. With {@link onDeleteFile} it
   * reads Remove from canvas: it takes away only the view.
   */
  onDelete?: () => void
  /** A Document's or Mockup's view: delete its file and every view (#1884). */
  onDeleteFile?: () => void
}

/** Every … trigger's name and tooltip: "Frame options", "Group options". */
export function layerMenuLabel(noun: LayerMenuActions["noun"]) {
  return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} options`
}

/** A Group's menu, the same on its canvas label and its sidebar row. */
export function groupLayerMenu(
  groupId: string,
  onDelete: () => void
): LayerMenuActions {
  return { noun: "group", moveTo: { kind: "group", id: groupId }, onDelete }
}

type PendingRename = { kind: "layer" } | { kind: "chat"; branchId: string }

/**
 * The menu's content. Rename starts once the menu has closed: Radix's focus
 * trap is still up while it closes and would steal focus back from the inline
 * field, so it waits for `onCloseAutoFocus`. The Chat submenu's Rename opens
 * the chat and renames its header the same way.
 */
export function LayerMenuContent({
  actions,
  layerId,
  onRename,
  onCloseAutoFocus,
  ...contentProps
}: {
  /** The menu, or the fallback when `layerId`'s Layer hasn't published one. */
  actions: LayerMenuActions
  /** A sidebar row's Layer: opens the menu the Layer published, if mounted. */
  layerId?: string
  /** Starts the inline rename of the object's name where the menu opened. */
  onRename?: () => void
  /** The menu's close when no rename is pending, e.g. to move focus. */
  onCloseAutoFocus?: (e: Event) => void
} & Pick<
  ComponentProps<typeof DropdownMenuContent>,
  "side" | "align" | "sideOffset"
>) {
  const pendingRef = useRef<PendingRename | null>(null)
  const chatsMenu = useChatsMenu()
  return (
    <DropdownMenuContent
      {...contentProps}
      onCloseAutoFocus={(e) => {
        const pending = pendingRef.current
        if (!pending) return onCloseAutoFocus?.(e)
        pendingRef.current = null
        e.preventDefault()
        if (pending.kind === "layer") onRename?.()
        else chatsMenu?.requestRename(pending.branchId)
      }}
    >
      {layerId ? (
        <PublishedLayerMenuItems
          layerId={layerId}
          fallback={actions}
          canRename={!!onRename}
          onPendingRename={(pending) => {
            pendingRef.current = pending
          }}
        />
      ) : (
        <LayerMenuItems
          actions={actions}
          canRename={!!onRename}
          onPendingRename={(pending) => {
            pendingRef.current = pending
          }}
        />
      )}
    </DropdownMenuContent>
  )
}

interface LayerMenuItemsProps {
  actions: LayerMenuActions
  canRename: boolean
  onPendingRename: (pending: PendingRename) => void
}

/** Mounted only while the menu is open, so a row listens to its Layer's
 *  menu only then. */
function PublishedLayerMenuItems({
  layerId,
  fallback,
  ...props
}: Omit<LayerMenuItemsProps, "actions"> & {
  layerId: string
  fallback: LayerMenuActions
}) {
  const published = useLayerMenu(layerId)
  return <LayerMenuItems actions={published ?? fallback} {...props} />
}

function LayerMenuItems({
  actions,
  canRename,
  onPendingRename,
}: LayerMenuItemsProps) {
  const { chat } = actions
  const branchId = chat?.branchId ?? undefined
  const hasWorkspaceMenu = useHasWorkspaceMenu(branchId)
  const showChat =
    !!chat && (hasWorkspaceMenu || !!chat.onPlay || !!chat.onOpenInBrowser)
  const showFrameItems = !!actions.size || !!actions.fitToContent || showChat
  const pages = useContext(MoveToPageContext)
  const canMove =
    !!actions.moveTo && !!pages?.pages.some((p) => p.id !== pages.currentPageId)
  const hasFirstSection =
    canRename ||
    !!actions.onDuplicate ||
    !!actions.onDuplicateAsNewFile ||
    canMove

  return (
    <>
      {canRename && (
        <DropdownMenuItem onSelect={() => onPendingRename({ kind: "layer" })}>
          <PencilSimpleIcon />
          Rename
        </DropdownMenuItem>
      )}
      {actions.onDuplicate && (
        <DropdownMenuItem onSelect={actions.onDuplicate}>
          <CopyIcon />
          Duplicate
          <MenuKeys keys={DUPLICATE_KEYS} />
        </DropdownMenuItem>
      )}
      {actions.onDuplicateAsNewFile && (
        <DropdownMenuItem onSelect={actions.onDuplicateAsNewFile}>
          <FilePlusIcon />
          Duplicate as new file
        </DropdownMenuItem>
      )}
      {actions.moveTo && <MoveToPageSubMenu target={actions.moveTo} />}
      {showFrameItems && (
        <>
          {hasFirstSection && <DropdownMenuSeparator />}
          {actions.size && (
            <DeviceSizeSubMenu
              width={actions.size.width}
              height={actions.size.height}
              onSelect={actions.size.onSelect}
            />
          )}
          {actions.fitToContent && (
            <DropdownMenuCheckboxItem
              checked={actions.fitToContent.checked}
              onCheckedChange={actions.fitToContent.onCheckedChange}
            >
              <ArrowsOutSimpleIcon />
              Fit to content
            </DropdownMenuCheckboxItem>
          )}
          {showChat && chat && (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <AppWindowIcon />
                  Preview
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {hasWorkspaceMenu && branchId ? (
                    <WorkspaceMenuItems
                      part="preview"
                      branchId={branchId}
                      onRename={() =>
                        onPendingRename({ kind: "chat", branchId })
                      }
                      onPlay={chat.onPlay}
                      onOpenInBrowser={chat.onOpenInBrowser}
                      onOpenLogs={chat.onOpenLogs}
                    />
                  ) : (
                    <>
                      {chat.onPlay && (
                        <DropdownMenuItem onSelect={chat.onPlay}>
                          <PlayIcon />
                          Open in play mode
                        </DropdownMenuItem>
                      )}
                      {chat.onOpenInBrowser && (
                        <OpenInBrowserItem onOpen={chat.onOpenInBrowser} />
                      )}
                    </>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {hasWorkspaceMenu && branchId && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <ChatCircleIcon />
                    Chat
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <WorkspaceMenuItems
                      part="chat"
                      branchId={branchId}
                      onRename={() =>
                        onPendingRename({ kind: "chat", branchId })
                      }
                    />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
            </>
          )}
        </>
      )}
      {(actions.onDelete || actions.onDeleteFile) && (
        <>
          {(hasFirstSection || showFrameItems) && <DropdownMenuSeparator />}
          {actions.onDelete &&
            (actions.onDeleteFile ? (
              <DropdownMenuItem onSelect={actions.onDelete}>
                <MinusSquareIcon />
                Remove from canvas
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                variant="destructive"
                onSelect={actions.onDelete}
              >
                <TrashIcon />
                Delete
              </DropdownMenuItem>
            ))}
          {actions.onDeleteFile && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={actions.onDeleteFile}
            >
              <TrashIcon />
              Delete file
            </DropdownMenuItem>
          )}
        </>
      )}
    </>
  )
}

export type LayerMenuPlacement = "toolbar" | "label" | "row"

/**
 * An object's … and its menu. `placement` picks the trigger:
 * - `toolbar`: the last button on a selected frame's or Mockup's toolbar.
 * - `label`: at the end of a canvas label row, at the name's height, for a
 *   document, a Group or a frame with no toolbar; showing it moves nothing.
 * - `row`: a sidebar row's hover …. It opens the menu the Layer published
 *   (`actions` stands in while the Layer isn't mounted), and deleting from it
 *   moves focus to the neighbouring row.
 */
export function LayerMenu(
  props: {
    /** The menu; on a row, the stand-in until the Layer publishes one. */
    actions: LayerMenuActions
    /** Starts the inline rename of the object's name where the menu opened. */
    onRename?: () => void
    /** The trigger's classes, e.g. a row's hover placement. */
    className?: string
  } & (
    | { placement: "toolbar" | "label" }
    | {
        placement: "row"
        /** The row's Layer or Group, whose published menu it opens. */
        layerId: string
      }
  )
) {
  // Every item changes the canvas or its chats: a viewer (#1933) has no ⋯.
  const watching = !!useViewing()
  if (watching) return null
  if (props.placement === "row") return <RowLayerMenu {...props} />
  const { placement, actions, onRename, className } = props
  const label = layerMenuLabel(actions.noun)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {placement === "toolbar" ? (
          <FloatingToolbarButton label={label} className={className}>
            <DotsThreeIcon className="text-muted-foreground" />
          </FloatingToolbarButton>
        ) : (
          <IconButton label={label} asChild>
            <button
              type="button"
              className={cn(
                "inline-flex h-[18px] shrink-0 cursor-pointer items-center text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground data-[state=open]:text-foreground",
                // Far out a label keeps its name and chat, not its menu.
                "group-data-compact/title-bar:hidden",
                className
              )}
              // Pressing it opens the menu; it doesn't select, drag or reorder.
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <DotsThreeIcon className="size-4" />
            </button>
          </IconButton>
        )}
      </DropdownMenuTrigger>
      {placement === "toolbar" ? (
        <LayerMenuContent
          actions={actions}
          onRename={onRename}
          side="bottom"
          align="end"
          sideOffset={8}
        />
      ) : (
        <LayerMenuContent
          actions={actions}
          onRename={onRename}
          side="bottom"
          align="start"
        />
      )}
    </DropdownMenu>
  )
}

function RowLayerMenu({
  layerId,
  actions,
  onRename,
  className,
}: {
  layerId: string
  actions: LayerMenuActions
  onRename?: () => void
  className?: string
}) {
  const { triggerRef, onOpenChange, onCloseAutoFocus } =
    useFocusNeighbourOnDelete()
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger ref={triggerRef} asChild>
        <IconButton
          label={layerMenuLabel(actions.noun)}
          tooltipSide="right"
          asChild
        >
          <SidebarMenuAction className={className}>
            <DotsThreeIcon />
          </SidebarMenuAction>
        </IconButton>
      </DropdownMenuTrigger>
      <LayerMenuContent
        layerId={layerId}
        actions={actions}
        onRename={onRename}
        onCloseAutoFocus={onCloseAutoFocus}
        side="right"
        align="start"
      />
    </DropdownMenu>
  )
}

/**
 * Where each canvas Layer publishes its menu so its sidebar row can open the
 * same one. The Layer owns some of its actions (a frame's Fit to content
 * measures its page), so it registers them while mounted; a row whose Layer
 * isn't mounted falls back to Rename and Delete.
 */
class LayerMenuRegistry {
  private menus = new Map<string, LayerMenuActions>()
  private listeners = new Set<() => void>()

  set(id: string, actions: LayerMenuActions | undefined) {
    if (actions) this.menus.set(id, actions)
    else this.menus.delete(id)
    for (const listener of this.listeners) listener()
  }

  get(id: string) {
    return this.menus.get(id)
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

// One canvas is mounted at a time and Layer ids are unique, so the canvas
// shares one registry; a provider gives a test its own.
const LayerMenuRegistryContext = createContext(new LayerMenuRegistry())

/** A registry of its own, for a test. */
export function LayerMenuProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(() => new LayerMenuRegistry())
  return (
    <LayerMenuRegistryContext.Provider value={registry}>
      {children}
    </LayerMenuRegistryContext.Provider>
  )
}

/** Publishes a Layer's menu for its sidebar row while the Layer is mounted. */
export function useRegisterLayerMenu(id: string, actions: LayerMenuActions) {
  const registry = useContext(LayerMenuRegistryContext)
  // A Layer rebuilds its actions every render. Publishing each copy would
  // wake every row subscribed to the registry, so publish one that keeps its
  // identity until a label or option changes; its callbacks call the latest.
  const [stable] = useState(() => new StableProps())
  const published = stable.value("menu", actions)
  useEffect(() => {
    registry.set(id, published)
  }, [registry, id, published])
  useEffect(() => () => registry.set(id, undefined), [registry, id])
}

/** {@link useRegisterLayerMenu} as an element, for menus built in a list,
 *  such as each Group's on the canvas. */
export function PublishLayerMenu({
  id,
  actions,
}: {
  id: string
  actions: LayerMenuActions
}) {
  useRegisterLayerMenu(id, actions)
  return null
}

/** The menu a mounted Layer published, for its sidebar row. */
export function useLayerMenu(id: string): LayerMenuActions | undefined {
  const registry = useContext(LayerMenuRegistryContext)
  const subscribe = useCallback(
    (listener: () => void) => registry.subscribe(listener),
    [registry]
  )
  return useSyncExternalStore(
    subscribe,
    () => registry.get(id),
    () => undefined
  )
}
