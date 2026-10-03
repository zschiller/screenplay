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
  ChatCircleIcon,
  CopyIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  PlayIcon,
  TrashIcon,
} from "@workspace/ui/components/icons"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { IconButton } from "@workspace/ui/components/icon-button"
import { cn } from "@workspace/ui/lib/utils"
import { useChatsMenu } from "@/components/agent/chats-menu"
import {
  WorkspaceMenuItems,
  useHasWorkspaceMenu,
} from "@/components/agent/workspace-menu"
import { MenuKeys } from "@/components/menu-keys"
import { OpenInBrowserItem } from "@/components/open-in-browser-item"
import { DUPLICATE_KEYS } from "@/lib/canvas/shortcuts"
import { DeviceSizeSubMenu } from "./device-size-menu"

/**
 * One menu per object (I7): a frame, mockup, document or Group has one menu,
 * and the sidebar row's … and the canvas's … (the toolbar's, or the label's
 * for a document or Group) both render it from here, so the two can't drift.
 *
 * The items, in order, each shown when the object has it: Rename, Duplicate,
 * then the frame's Device size, Fit to content and Chat, then Delete.
 */
export interface LayerMenuActions {
  /** The object, for the trigger's name ("Frame options"). */
  noun: "frame" | "mockup" | "document" | "group"
  onDuplicate?: () => void
  size?: {
    width: number
    height: number
    onSelect: (width: number, height: number) => void
  }
  onFitToContent?: () => void
  /** The frame's Workspace's menu, under Chat (H4). */
  chat?: {
    branchId: string | null | undefined
    onPlay?: () => void
    onOpenInBrowser?: () => void
  }
  onDelete: () => void
}

export function layerMenuLabel(noun: LayerMenuActions["noun"]) {
  return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} options`
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
  ...contentProps
}: {
  /** The menu, or the fallback when `layerId`'s Layer hasn't published one. */
  actions: LayerMenuActions
  /** A sidebar row's Layer: opens the menu the Layer published, if mounted. */
  layerId?: string
  /** Starts the inline rename of the object's name where the menu opened. */
  onRename?: () => void
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
        if (!pending) return
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
  const showFrameItems = !!actions.size || !!actions.onFitToContent || showChat

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
      {showFrameItems && (
        <>
          {(canRename || actions.onDuplicate) && <DropdownMenuSeparator />}
          {actions.size && (
            <DeviceSizeSubMenu
              width={actions.size.width}
              height={actions.size.height}
              onSelect={actions.size.onSelect}
            />
          )}
          {actions.onFitToContent && (
            <DropdownMenuItem onSelect={actions.onFitToContent}>
              <ArrowsOutSimpleIcon />
              Fit to content
            </DropdownMenuItem>
          )}
          {showChat && chat && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ChatCircleIcon />
                Chat
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {hasWorkspaceMenu && branchId ? (
                  // The Workspace's whole menu, as in its chat header (H4),
                  // opening on this frame.
                  <WorkspaceMenuItems
                    branchId={branchId}
                    onRename={() => onPendingRename({ kind: "chat", branchId })}
                    onPlay={chat.onPlay}
                    onOpenInBrowser={chat.onOpenInBrowser}
                  />
                ) : (
                  <>
                    {chat.onPlay && (
                      <DropdownMenuItem onSelect={chat.onPlay}>
                        <PlayIcon />
                        Open prototype player
                      </DropdownMenuItem>
                    )}
                    {chat.onOpenInBrowser && (
                      <OpenInBrowserItem onOpen={chat.onOpenInBrowser} />
                    )}
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
        </>
      )}
      {(canRename || actions.onDuplicate || showFrameItems) && (
        <DropdownMenuSeparator />
      )}
      <DropdownMenuItem variant="destructive" onSelect={actions.onDelete}>
        <TrashIcon />
        Delete
      </DropdownMenuItem>
    </>
  )
}

/**
 * The … on a selected document's or Group's canvas label, which has no
 * toolbar of its own. Sits at the end of the label row at the name's height,
 * so showing it moves nothing.
 */
export function LayerLabelMenu({
  actions,
  onRename,
  className,
}: {
  actions: LayerMenuActions
  onRename?: () => void
  className?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={layerMenuLabel(actions.noun)} asChild>
          <button
            type="button"
            className={cn(
              "inline-flex h-[18px] shrink-0 cursor-pointer items-center text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground data-[state=open]:text-foreground",
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
      </DropdownMenuTrigger>
      <LayerMenuContent
        actions={actions}
        onRename={onRename}
        side="bottom"
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
  useEffect(() => {
    registry.set(id, actions)
  })
  useEffect(() => () => registry.set(id, undefined), [registry, id])
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
