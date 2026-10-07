"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { FloatingToolbar } from "@workspace/ui/components/floating-toolbar"
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import {
  CaretDownIcon,
  FolderOpenIcon,
  PlusIcon,
} from "@workspace/ui/components/icons"
import { IconButton } from "@workspace/ui/components/icon-button"
import { InputGroupButton } from "@workspace/ui/components/input-group"
import { cn } from "@workspace/ui/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"

import {
  Composer,
  type ComposerHandle,
  type ComposerSubmitPayload,
} from "@/components/agent/composer"
import { FILE_KIND_ICON } from "@/components/agent/file-tiles"
import { ScrollHairline, useScrollEdges } from "@/components/scroll-hairline"
import { WorkspaceMention } from "@/components/workspace-mention"
import { useWorkspaceStates } from "@/hooks/use-workspace-states"
import { hasModKey } from "@/lib/canvas/key-target"
import { NEW_CHAT, NEW_SKETCH_CHAT, type FrameAnswerer } from "@/lib/draw-ask"
import type {
  BranchData,
  ChatSessionData,
  LayerFileData,
  MarkdownLayerData,
} from "@/lib/types"
import { workspaceLabel } from "@/lib/workspace-label"
import { WorkspaceCommandList, WorkspaceName } from "./workspace-list"

/** Keeps the card clear of the canvas edges and the bottom tool toolbar. */
const INSET = 8
const CANVAS_TOOLBAR_STRIP = 48

/**
 * Marks a popup a composer opens outside the card (the `@` and `/` pickers),
 * so a pointer-down in it doesn't count as clicking away.
 */
export const COMPOSER_POPUP_ATTRIBUTE = "data-composer-popup"

/** Where the drawn box sits on screen, relative to the canvas wrapper. */
export type AskCardTarget = {
  left: number
  top: number
  width: number
  height: number
}

/**
 * The drawn box a card asks about: a frame, a Mockup box (#1359), or a
 * Document.
 */
export type AskCardKind = "frame" | "mockup" | "document"

const QUESTION: Record<AskCardKind, string> = {
  frame: "What should this frame show?",
  mockup: "What should this mockup show?",
  document: "What should this document say?",
}

/** What a drawn box's card says about the files it can open (#1890). */
const FILE_WORDS = {
  mockup: {
    open: "Open mockup",
    search: "Search mockups…",
    create: "New mockup",
    untitled: "Untitled mockup",
  },
  document: {
    open: "Open document",
    search: "Search documents…",
    create: "New document",
    untitled: "Untitled",
  },
} as const

/** A file a drawn box can open: a Mockup's or a Document's. */
export type AskCardFile = Pick<LayerFileData, "id" | "title">

/**
 * Where a frame sits on screen, relative to the canvas wrapper: the frame
 * lives inside the world transform, the card in screen space.
 */
export function frameAskTarget(frameId: string): AskCardTarget | null {
  return layerAskTarget(`iframe-layer-${frameId}`)
}

/** Where a Document's page sits on screen, as `frameAskTarget`. */
export function documentAskTarget(documentId: string): AskCardTarget | null {
  return layerAskTarget(`markdown-layer-${documentId}`)
}

function layerAskTarget(elementId: string): AskCardTarget | null {
  const wrapper = document.querySelector<HTMLElement>("[data-canvas-wrapper]")
  const frame = document.getElementById(elementId)
  if (!wrapper || !frame) return null
  const fr = frame.getBoundingClientRect()
  const cw = wrapper.getBoundingClientRect()
  return {
    left: fr.left - cw.left,
    top: fr.top - cw.top,
    width: fr.width,
    height: fr.height,
  }
}

/**
 * The ask a drawn frame or Mockup box opens (#1356, #1359, spec #1355): the
 * chat composer on the shared floating surface, centred on the box in screen
 * space, so it reads the same at any zoom. A chip where the model pill sits
 * says who answers and switches it (#1357): New chat or any Workspace,
 * starting from the default the canvas worked out from the selection. A new
 * chat's turn uses the default model; a Workspace's chat keeps its own.
 *
 * A drawn frame with running previews to offer asks which to show first
 * (`previews`, the likely one leading and highlighted): Enter shows it in the
 * frame and sends nothing. Its last row, New chat…, turns the card into the
 * composer, carrying what was typed when no preview matched it.
 *
 * A drawn Mockup box or Document opens on the prompt, and when the canvas
 * has files of its kind, Open mockup / Open document (⌘O) beside Send backs
 * out to them (#1890): the frame card inverted. The search starts from what
 * was typed; picking a file makes the box a view of it (`onOpen`), and New
 * mockup… (or Esc) comes back to the prompt, carrying what was typed.
 *
 * On a drawn Document, Esc writes it by hand instead (`onWriteMyself`): the
 * Document opens for editing, what was typed becoming its title.
 *
 * Per-viewer: the canvas holds which box is asking in local state, never in
 * the room doc. Enter sends; Esc or a pointer-down outside closes it, leaving
 * a frame or Document as it is (an unsent Mockup box goes with the card).
 */
export function FrameAskCard({
  kind = "frame",
  locate,
  markdownLayers,
  workspaces,
  sketchChats,
  defaultAnswerer,
  previews = [],
  onShow,
  onSubmit,
  onWriteMyself,
  files = [],
  onOpen,
  onClose,
}: {
  kind?: AskCardKind
  /** The box's screen rect, read every animation frame; null until it's up. */
  locate: () => AskCardTarget | null
  markdownLayers: MarkdownLayerData[]
  /** Every Workspace, for the chip's menu. */
  workspaces: BranchData[]
  /**
   * The chats with no repository, for a Mockup box's chip. Given, the chip
   * offers them and a new one; on a canvas with no repository it offers only
   * those.
   */
  sketchChats?: ChatSessionData[]
  defaultAnswerer: FrameAnswerer
  /** Running previews to offer before the composer, the likely one first. */
  previews?: BranchData[]
  /** Show a picked preview in the frame. */
  onShow?: (branchId: string) => void
  onSubmit: (payload: ComposerSubmitPayload, answerer: FrameAnswerer) => void
  /** Esc on a drawn Document: write it yourself, with what was typed so far. */
  onWriteMyself?: (text: string) => void
  /** The canvas's files of the drawn kind, for a Mockup box or Document. */
  files?: AskCardFile[]
  /** Make the drawn box a view of an existing file. */
  onOpen?: (fileId: string) => void
  onClose: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [answerer, setAnswerer] = useState(defaultAnswerer)
  const [picking, setPicking] = useState(previews.length > 0 && !!onShow)
  const fileKind = kind === "frame" ? null : kind
  const canOpen = !!fileKind && !!onOpen && files.length > 0
  // The open file search, and what it starts from: null on the prompt.
  const [opening, setOpening] = useState<string | null>(null)
  const composerRef = useRef<ComposerHandle>(null)
  // What's typed, for Esc's write it myself to carry into the title and the
  // file search to start from.
  const draftRef = useRef("")
  // Words typed into a picker that no preview matched, or a file search, for
  // the composer to start from once it's mounted.
  const carriedRef = useRef("")
  useEffect(() => {
    if (picking || opening !== null || !carriedRef.current) return
    composerRef.current?.insertText(carriedRef.current)
    carriedRef.current = ""
  }, [picking, opening])
  const openFiles = () => {
    if (!canOpen || opening !== null) return
    setOpening(draftRef.current.trim())
  }
  const backToPrompt = (text: string) => {
    carriedRef.current = text
    draftRef.current = ""
    setOpening(null)
  }
  const onCloseRef = useRef(onClose)
  const locateRef = useRef(locate)
  useEffect(() => {
    onCloseRef.current = onClose
    locateRef.current = locate
  })

  // Centre the card on the box every frame, the way the frame bar follows its
  // frame. Hidden until the box is up and the card is placed. Centred on the
  // height it first shows at, so its top stays put as the preview list
  // filters or turns into the composer.
  useEffect(() => {
    const wrapper = document.querySelector<HTMLElement>("[data-canvas-wrapper]")
    if (!wrapper) return
    let rafId = 0
    let centredHeight = 0
    const tick = () => {
      const box = locateRef.current()
      const card = cardRef.current
      if (box && card) {
        const cw = wrapper.getBoundingClientRect()
        const w = card.offsetWidth
        const h = card.offsetHeight
        centredHeight ||= h
        const x = box.left + (box.width - w) / 2
        const y = box.top + (box.height - centredHeight) / 2
        const clampedX = Math.max(INSET, Math.min(x, cw.width - w - INSET))
        const clampedY = Math.max(
          INSET,
          Math.min(y, cw.height - CANVAS_TOOLBAR_STRIP - h)
        )
        card.style.transform = `translate(${clampedX}px, ${clampedY}px)`
        card.style.visibility = "visible"
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  // A pointer-down anywhere but the card (or a picker it opened) closes it.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (cardRef.current?.contains(target)) return
      if (
        target instanceof Element &&
        target.closest(`[${COMPOSER_POPUP_ATTRIBUTE}]`)
      )
        return
      onCloseRef.current()
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true)
  }, [])

  const portal =
    typeof document !== "undefined"
      ? document.getElementById("frame-toolbar-portal")
      : null
  if (!portal) return null

  return createPortal(
    <FloatingToolbar
      ref={cardRef}
      role="dialog"
      aria-label={QUESTION[kind]}
      className={cn(
        "invisible absolute top-0 left-0 block w-88 max-w-[calc(100%-1rem)]",
        picking ? "p-0" : "p-1"
      )}
      // React bubbles a portal's events up its owner tree, through the
      // canvas's gesture handlers; the card is not the canvas.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      // Caught on the way down: the composer claims Esc for itself (it lets
      // go of focus). An open `@` or `/` picker still takes it first.
      onKeyDownCapture={(e) => {
        // ⌘O opens a file here, never the browser's file dialog.
        if (
          canOpen &&
          e.key.toLowerCase() === "o" &&
          hasModKey(e) &&
          !e.altKey &&
          !e.shiftKey
        ) {
          e.preventDefault()
          e.stopPropagation()
          openFiles()
          return
        }
        if (e.key !== "Escape") return
        // The file search takes its own Esc, back to the prompt with what
        // was typed.
        if (opening !== null) return
        if (document.querySelector(`[${COMPOSER_POPUP_ATTRIBUTE}]`)) return
        e.preventDefault()
        e.stopPropagation()
        if (onWriteMyself) onWriteMyself(draftRef.current)
        else onClose()
      }}
    >
      {opening !== null && fileKind && onOpen ? (
        <FilePicker
          kind={fileKind}
          files={files}
          initialQuery={opening}
          onOpen={onOpen}
          onBack={backToPrompt}
        />
      ) : picking && onShow ? (
        <PreviewPicker
          previews={previews}
          onShow={onShow}
          onNewChat={(text) => {
            setAnswerer(NEW_CHAT)
            carriedRef.current = text
            setPicking(false)
          }}
        />
      ) : (
        <Composer
          ref={composerRef}
          markdownLayers={markdownLayers}
          onModelChange={() => {}}
          onSubmit={(payload) => onSubmit(payload, answerer)}
          onChange={
            onWriteMyself || canOpen
              ? (payload) => {
                  draftRef.current = payload.text
                }
              : undefined
          }
          focusKey={1}
          placeholder={QUESTION[kind]}
          modelSlot={
            <AnswererChip
              answerer={answerer}
              workspaces={workspaces}
              sketchChats={sketchChats}
              onChange={setAnswerer}
            />
          }
          beforeSend={
            canOpen &&
            fileKind && (
              <IconButton
                asChild
                label={FILE_WORDS[fileKind].open}
                shortcut="⌘O"
              >
                <InputGroupButton
                  size="sm"
                  className="text-foreground"
                  onClick={openFiles}
                >
                  <FolderOpenIcon />
                  {FILE_WORDS[fileKind].open}
                </InputGroupButton>
              </IconButton>
            )
          }
          // The card is the surface: the composer's own box goes borderless.
          className="relative [&_[data-slot=input-group]]:border-transparent dark:[&_[data-slot=input-group]]:bg-transparent"
        />
      )}
    </FloatingToolbar>,
    portal
  )
}

/**
 * The running previews a drawn frame offers: a search over them, the likely one first so Enter shows it,
 * then New chat… on its own row. Typing filters by name; with nothing
 * matching, the row carries the words into the composer as the new chat's
 * first message (`New chat: “…”`).
 *
 * Only the previews scroll; New chat… stays pinned under them, still inside
 * the `CommandList` because cmdk's arrow keys only reach items there. The
 * hairlines under the search and above New chat… show only while previews
 * are scrolled under them, and every gap is 4px, a menu's density.
 */
function PreviewPicker({
  previews,
  onShow,
  onNewChat,
}: {
  previews: BranchData[]
  onShow: (branchId: string) => void
  /** Open the composer, with what was typed when nothing matched it. */
  onNewChat: (text: string) => void
}) {
  const stateOf = useWorkspaceStates()
  const [query, setQuery] = useState("")
  // The card stays hidden until it's placed on the frame, and a hidden field
  // can't take focus: focus the search once it shows.
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let rafId = 0
    const focusWhenShown = () => {
      const input = inputRef.current
      if (!input) return
      if (getComputedStyle(input).visibility === "hidden") {
        rafId = requestAnimationFrame(focusWhenShown)
        return
      }
      input.focus()
    }
    rafId = requestAnimationFrame(focusWhenShown)
    return () => cancelAnimationFrame(rafId)
  }, [])
  const typed = query.trim()
  const q = typed.toLowerCase()
  const matches = q
    ? previews.filter((b) =>
        `${workspaceLabel(b)} ${b.ref}`.toLowerCase().includes(q)
      )
    : previews
  const carry = matches.length === 0 ? typed : ""
  const { attach, onScroll, above, below } = useScrollEdges()
  return (
    <Command
      shouldFilter={false}
      loop
      className="bg-transparent p-0 [&_[data-slot=command-input-wrapper]]:p-1"
    >
      <CommandInput
        ref={inputRef}
        value={query}
        onValueChange={setQuery}
        placeholder="Search running previews…"
      />
      <CommandList className="max-h-none overflow-visible">
        {matches.length > 0 && (
          <div className="relative">
            <ScrollHairline shown={above} />
            <div
              ref={attach}
              onScroll={onScroll}
              className="no-scrollbar max-h-72 overflow-y-auto px-1 pb-0.5"
            >
              <CommandGroup className="p-0">
                {matches.map((b) => (
                  <CommandItem
                    key={b.id}
                    value={b.id}
                    onSelect={() => onShow(b.id)}
                  >
                    <WorkspaceMention branch={b} state={stateOf(b)} />
                  </CommandItem>
                ))}
              </CommandGroup>
            </div>
            <ScrollHairline shown={below} edge="bottom" />
          </div>
        )}
        <CommandGroup
          className={cn("p-1", matches.length > 0 ? "pt-0.5" : "pt-0")}
        >
          <CommandItem value="new-chat" onSelect={() => onNewChat(carry)}>
            <PlusIcon className="text-muted-foreground" />
            <span className="flex-1 truncate">
              {carry ? `New chat: “${carry}”` : "New chat…"}
            </span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

/**
 * The files a drawn Mockup box or Document can open instead (#1890), the
 * running-previews picker turned around: a search over this canvas's files of
 * the drawn kind, starting from what was typed in the prompt, then New mockup…
 * (or New document…) pinned under them, back to the prompt. Picking a file
 * opens it in the box. Esc goes back too. Either way what was typed goes with
 * it, and with no file matching, the row says so (`New mockup: “…”`).
 */
function FilePicker({
  kind,
  files,
  initialQuery,
  onOpen,
  onBack,
}: {
  kind: "mockup" | "document"
  files: AskCardFile[]
  initialQuery: string
  onOpen: (fileId: string) => void
  onBack: (text: string) => void
}) {
  const words = FILE_WORDS[kind]
  const Icon = FILE_KIND_ICON[kind]
  const [query, setQuery] = useState(initialQuery)
  // As the previews' search: focus once the card shows.
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let rafId = 0
    const focusWhenShown = () => {
      const input = inputRef.current
      if (!input) return
      if (getComputedStyle(input).visibility === "hidden") {
        rafId = requestAnimationFrame(focusWhenShown)
        return
      }
      input.focus()
    }
    rafId = requestAnimationFrame(focusWhenShown)
    return () => cancelAnimationFrame(rafId)
  }, [])
  const typed = query.trim()
  const q = typed.toLowerCase()
  const matches = q
    ? files.filter((f) => (f.title || words.untitled).toLowerCase().includes(q))
    : files
  const carry = matches.length === 0 ? typed : ""
  const { attach, onScroll, above, below } = useScrollEdges()
  return (
    <Command
      shouldFilter={false}
      loop
      className="bg-transparent p-0 [&_[data-slot=command-input-wrapper]]:p-1"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return
        e.preventDefault()
        e.stopPropagation()
        onBack(typed)
      }}
    >
      <CommandInput
        ref={inputRef}
        value={query}
        onValueChange={setQuery}
        placeholder={words.search}
      />
      <CommandList className="max-h-none overflow-visible">
        {matches.length > 0 && (
          <div className="relative">
            <ScrollHairline shown={above} />
            <div
              ref={attach}
              onScroll={onScroll}
              className="no-scrollbar max-h-72 overflow-y-auto px-1 pb-0.5"
            >
              <CommandGroup className="p-0">
                {matches.map((f) => (
                  <CommandItem
                    key={f.id}
                    value={f.id}
                    onSelect={() => onOpen(f.id)}
                  >
                    <Icon />
                    <span className="flex-1 truncate">
                      {f.title || words.untitled}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </div>
            <ScrollHairline shown={below} edge="bottom" />
          </div>
        )}
        <CommandGroup
          className={cn("p-1", matches.length > 0 ? "pt-0.5" : "pt-0")}
        >
          <CommandItem value="new" onSelect={() => onBack(typed)}>
            <PlusIcon className="text-muted-foreground" />
            <span className="flex-1 truncate">
              {carry ? `${words.create}: “${carry}”` : `${words.create}…`}
            </span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

/**
 * Who answers, in the model pill's place and look (#1357). Its menu is the
 * frames' Workspace list with New chat first, and for a Mockup box the chats
 * with no repository after it. On a canvas with no repository a new chat with
 * none is the default; with nothing else to pick, the chip only says so.
 */
function AnswererChip({
  answerer,
  workspaces,
  sketchChats,
  onChange,
}: {
  answerer: FrameAnswerer
  workspaces: BranchData[]
  sketchChats?: ChatSessionData[]
  onChange: (answerer: FrameAnswerer) => void
}) {
  const [open, setOpen] = useState(false)
  const workspace =
    answerer.kind === "workspace"
      ? workspaces.find((b) => b.id === answerer.branchId)
      : undefined
  const sketchChat =
    answerer.kind === "sketch" && answerer.chatId
      ? sketchChats?.find((c) => c.id === answerer.chatId)
      : undefined
  // No repository: only chats with none can answer.
  const noRepository = answerer.kind === "sketch" && workspaces.length === 0
  if (noRepository && !sketchChats?.length) {
    return (
      <span className="inline-flex min-w-0 items-center pl-0.75 text-sm text-foreground">
        New chat
      </span>
    )
  }
  const label = workspace ? (
    <WorkspaceName workspace={workspace} />
  ) : sketchChat ? (
    <span className="truncate">{sketchChat.label}</span>
  ) : answerer.kind === "sketch" && !noRepository ? (
    "New chat, no repository"
  ) : (
    "New chat"
  )
  const pick = (next: FrameAnswerer) => {
    onChange(next)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span className="-ml-1.5 inline-flex min-w-0">
        <PopoverTrigger asChild>
          <InputGroupButton
            size="sm"
            aria-label="Who answers"
            className="max-w-48 text-foreground"
          >
            {label}
            <CaretDownIcon />
          </InputGroupButton>
        </PopoverTrigger>
      </span>
      <PopoverContent
        {...{ [COMPOSER_POPUP_ATTRIBUTE]: "" }}
        className="w-72 p-0"
        side="bottom"
        align="start"
      >
        <WorkspaceCommandList
          branches={workspaces}
          currentBranchId={workspace?.id}
          onPick={(branchId) => pick({ kind: "workspace", branchId })}
          newChat={
            noRepository
              ? undefined
              : {
                  current: answerer.kind === "new-chat",
                  onPick: () => pick(NEW_CHAT),
                }
          }
          sketch={
            sketchChats
              ? {
                  chats: sketchChats,
                  current:
                    answerer.kind === "sketch"
                      ? (answerer.chatId ?? "new")
                      : null,
                  onPick: (chatId) =>
                    pick(chatId ? { kind: "sketch", chatId } : NEW_SKETCH_CHAT),
                }
              : undefined
          }
        />
      </PopoverContent>
    </Popover>
  )
}
