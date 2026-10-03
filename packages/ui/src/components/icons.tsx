import * as React from "react"
import type { Icon, IconProps } from "@phosphor-icons/react"

import { cn } from "@workspace/ui/lib/utils"

import { AppWindowIcon as AppWindowBase } from "@phosphor-icons/react/dist/ssr/AppWindow"
import { ArchiveIcon as ArchiveBase } from "@phosphor-icons/react/dist/ssr/Archive"
import { ArrowClockwiseIcon as ArrowClockwiseBase } from "@phosphor-icons/react/dist/ssr/ArrowClockwise"
import { ArrowCounterClockwiseIcon as ArrowCounterClockwiseBase } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise"
import { ArrowDownIcon as ArrowDownBase } from "@phosphor-icons/react/dist/ssr/ArrowDown"
import { ArrowLeftIcon as ArrowLeftBase } from "@phosphor-icons/react/dist/ssr/ArrowLeft"
import { ArrowRightIcon as ArrowRightBase } from "@phosphor-icons/react/dist/ssr/ArrowRight"
import { ArrowSquareOutIcon as ArrowSquareOutBase } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut"
import { ArrowUUpLeftIcon as ArrowUUpLeftBase } from "@phosphor-icons/react/dist/ssr/ArrowUUpLeft"
import { ArrowUpIcon as ArrowUpBase } from "@phosphor-icons/react/dist/ssr/ArrowUp"
import { ArrowUpRightIcon as ArrowUpRightBase } from "@phosphor-icons/react/dist/ssr/ArrowUpRight"
import { ArrowsClockwiseIcon as ArrowsClockwiseBase } from "@phosphor-icons/react/dist/ssr/ArrowsClockwise"
import { ArrowsDownUpIcon as ArrowsDownUpBase } from "@phosphor-icons/react/dist/ssr/ArrowsDownUp"
import { ArrowsMergeIcon as ArrowsMergeBase } from "@phosphor-icons/react/dist/ssr/ArrowsMerge"
import { ArrowsOutCardinalIcon as ArrowsOutCardinalBase } from "@phosphor-icons/react/dist/ssr/ArrowsOutCardinal"
import { ArrowsOutSimpleIcon as ArrowsOutSimpleBase } from "@phosphor-icons/react/dist/ssr/ArrowsOutSimple"
import { BookBookmarkIcon as BookBookmarkBase } from "@phosphor-icons/react/dist/ssr/BookBookmark"
import { BookOpenIcon as BookOpenBase } from "@phosphor-icons/react/dist/ssr/BookOpen"
import { BracketsCurlyIcon as BracketsCurlyBase } from "@phosphor-icons/react/dist/ssr/BracketsCurly"
import { BroadcastIcon as BroadcastBase } from "@phosphor-icons/react/dist/ssr/Broadcast"
import { CaretDownIcon as CaretDownBase } from "@phosphor-icons/react/dist/ssr/CaretDown"
import { CaretLeftIcon as CaretLeftBase } from "@phosphor-icons/react/dist/ssr/CaretLeft"
import { CaretRightIcon as CaretRightBase } from "@phosphor-icons/react/dist/ssr/CaretRight"
import { CaretUpIcon as CaretUpBase } from "@phosphor-icons/react/dist/ssr/CaretUp"
import { CaretUpDownIcon as CaretUpDownBase } from "@phosphor-icons/react/dist/ssr/CaretUpDown"
import { ChatIcon as ChatBase } from "@phosphor-icons/react/dist/ssr/Chat"
import { ChatCircleIcon as ChatCircleBase } from "@phosphor-icons/react/dist/ssr/ChatCircle"
import { ChatSlashIcon as ChatSlashBase } from "@phosphor-icons/react/dist/ssr/ChatSlash"
import { ChatTextIcon as ChatTextBase } from "@phosphor-icons/react/dist/ssr/ChatText"
import { ChatsIcon as ChatsBase } from "@phosphor-icons/react/dist/ssr/Chats"
import { CheckIcon as CheckBase } from "@phosphor-icons/react/dist/ssr/Check"
import { CheckCircleIcon as CheckCircleBase } from "@phosphor-icons/react/dist/ssr/CheckCircle"
import { CircleIcon as CircleBase } from "@phosphor-icons/react/dist/ssr/Circle"
import { CircleDashedIcon as CircleDashedBase } from "@phosphor-icons/react/dist/ssr/CircleDashed"
import { CircleNotchIcon as CircleNotchBase } from "@phosphor-icons/react/dist/ssr/CircleNotch"
import { ClipboardTextIcon as ClipboardTextBase } from "@phosphor-icons/react/dist/ssr/ClipboardText"
import { ClockIcon as ClockBase } from "@phosphor-icons/react/dist/ssr/Clock"
import { ClockCounterClockwiseIcon as ClockCounterClockwiseBase } from "@phosphor-icons/react/dist/ssr/ClockCounterClockwise"
import { CodeIcon as CodeBase } from "@phosphor-icons/react/dist/ssr/Code"
import { CodeBlockIcon as CodeBlockBase } from "@phosphor-icons/react/dist/ssr/CodeBlock"
import { CopyIcon as CopyBase } from "@phosphor-icons/react/dist/ssr/Copy"
import { CrosshairIcon as CrosshairBase } from "@phosphor-icons/react/dist/ssr/Crosshair"
import { CursorIcon as CursorBase } from "@phosphor-icons/react/dist/ssr/Cursor"
import { DeviceMobileIcon as DeviceMobileBase } from "@phosphor-icons/react/dist/ssr/DeviceMobile"
import { DeviceTabletIcon as DeviceTabletBase } from "@phosphor-icons/react/dist/ssr/DeviceTablet"
import { DevicesIcon as DevicesBase } from "@phosphor-icons/react/dist/ssr/Devices"
import { DotsSixVerticalIcon as DotsSixVerticalBase } from "@phosphor-icons/react/dist/ssr/DotsSixVertical"
import { DotsThreeIcon as DotsThreeBase } from "@phosphor-icons/react/dist/ssr/DotsThree"
import { EyeIcon as EyeBase } from "@phosphor-icons/react/dist/ssr/Eye"
import { EyeSlashIcon as EyeSlashBase } from "@phosphor-icons/react/dist/ssr/EyeSlash"
import { DownloadSimpleIcon as DownloadSimpleBase } from "@phosphor-icons/react/dist/ssr/DownloadSimple"
import { FileIcon as FileBase } from "@phosphor-icons/react/dist/ssr/File"
import { FileCodeIcon as FileCodeBase } from "@phosphor-icons/react/dist/ssr/FileCode"
import { FileImageIcon as FileImageBase } from "@phosphor-icons/react/dist/ssr/FileImage"
import { FilePdfIcon as FilePdfBase } from "@phosphor-icons/react/dist/ssr/FilePdf"
import { FilePlusIcon as FilePlusBase } from "@phosphor-icons/react/dist/ssr/FilePlus"
import { FileTextIcon as FileTextBase } from "@phosphor-icons/react/dist/ssr/FileText"
import { FilesIcon as FilesBase } from "@phosphor-icons/react/dist/ssr/Files"
import { FolderIcon as FolderBase } from "@phosphor-icons/react/dist/ssr/Folder"
import { FolderLockIcon as FolderLockBase } from "@phosphor-icons/react/dist/ssr/FolderLock"
import { FolderOpenIcon as FolderOpenBase } from "@phosphor-icons/react/dist/ssr/FolderOpen"
import { FolderPlusIcon as FolderPlusBase } from "@phosphor-icons/react/dist/ssr/FolderPlus"
import { FolderSimpleIcon as FolderSimpleBase } from "@phosphor-icons/react/dist/ssr/FolderSimple"
import { FunnelSimpleIcon as FunnelSimpleBase } from "@phosphor-icons/react/dist/ssr/FunnelSimple"
import { GearIcon as GearBase } from "@phosphor-icons/react/dist/ssr/Gear"
import { GitBranchIcon as GitBranchBase } from "@phosphor-icons/react/dist/ssr/GitBranch"
import { GitDiffIcon as GitDiffBase } from "@phosphor-icons/react/dist/ssr/GitDiff"
import { GitForkIcon as GitForkBase } from "@phosphor-icons/react/dist/ssr/GitFork"
import { GitMergeIcon as GitMergeBase } from "@phosphor-icons/react/dist/ssr/GitMerge"
import { GitPullRequestIcon as GitPullRequestBase } from "@phosphor-icons/react/dist/ssr/GitPullRequest"
import { GlobeIcon as GlobeBase } from "@phosphor-icons/react/dist/ssr/Globe"
import { InfoIcon as InfoBase } from "@phosphor-icons/react/dist/ssr/Info"
import { FrameCornersIcon as FrameCornersBase } from "@phosphor-icons/react/dist/ssr/FrameCorners"
import { LayoutIcon as LayoutBase } from "@phosphor-icons/react/dist/ssr/Layout"
import { LightbulbIcon as LightbulbBase } from "@phosphor-icons/react/dist/ssr/Lightbulb"
import { LinkSimpleHorizontalIcon as LinkSimpleHorizontalBase } from "@phosphor-icons/react/dist/ssr/LinkSimpleHorizontal"
import { ListBulletsIcon as ListBulletsBase } from "@phosphor-icons/react/dist/ssr/ListBullets"
import { ListDashesIcon as ListDashesBase } from "@phosphor-icons/react/dist/ssr/ListDashes"
import { ListNumbersIcon as ListNumbersBase } from "@phosphor-icons/react/dist/ssr/ListNumbers"
import { MagnifyingGlassIcon as MagnifyingGlassBase } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass"
import { MinusIcon as MinusBase } from "@phosphor-icons/react/dist/ssr/Minus"
import { MonitorIcon as MonitorBase } from "@phosphor-icons/react/dist/ssr/Monitor"
import { MoonIcon as MoonBase } from "@phosphor-icons/react/dist/ssr/Moon"
import { NavigationArrowIcon as NavigationArrowBase } from "@phosphor-icons/react/dist/ssr/NavigationArrow"
import { NotepadIcon as NotepadBase } from "@phosphor-icons/react/dist/ssr/Notepad"
import { NotePencilIcon as NotePencilBase } from "@phosphor-icons/react/dist/ssr/NotePencil"
import { PathIcon as PathBase } from "@phosphor-icons/react/dist/ssr/Path"
import { PauseCircleIcon as PauseCircleBase } from "@phosphor-icons/react/dist/ssr/PauseCircle"
import { PencilSimpleIcon as PencilSimpleBase } from "@phosphor-icons/react/dist/ssr/PencilSimple"
import { PencilSimpleLineIcon as PencilSimpleLineBase } from "@phosphor-icons/react/dist/ssr/PencilSimpleLine"
import { PlayIcon as PlayBase } from "@phosphor-icons/react/dist/ssr/Play"
import { PlugIcon as PlugBase } from "@phosphor-icons/react/dist/ssr/Plug"
import { PlusIcon as PlusBase } from "@phosphor-icons/react/dist/ssr/Plus"
import { PushPinIcon as PushPinBase } from "@phosphor-icons/react/dist/ssr/PushPin"
import { PushPinSlashIcon as PushPinSlashBase } from "@phosphor-icons/react/dist/ssr/PushPinSlash"
import { QuestionIcon as QuestionBase } from "@phosphor-icons/react/dist/ssr/Question"
import { QuotesIcon as QuotesBase } from "@phosphor-icons/react/dist/ssr/Quotes"
import { RecycleIcon as RecycleBase } from "@phosphor-icons/react/dist/ssr/Recycle"
import { RobotIcon as RobotBase } from "@phosphor-icons/react/dist/ssr/Robot"
import { RowsIcon as RowsBase } from "@phosphor-icons/react/dist/ssr/Rows"
import { ScanIcon as ScanBase } from "@phosphor-icons/react/dist/ssr/Scan"
import { ScribbleIcon as ScribbleBase } from "@phosphor-icons/react/dist/ssr/Scribble"
import { ScrollIcon as ScrollBase } from "@phosphor-icons/react/dist/ssr/Scroll"
import { SelectionIcon as SelectionBase } from "@phosphor-icons/react/dist/ssr/Selection"
import { ShareNetworkIcon as ShareNetworkBase } from "@phosphor-icons/react/dist/ssr/ShareNetwork"
import { SidebarSimpleIcon as SidebarSimpleBase } from "@phosphor-icons/react/dist/ssr/SidebarSimple"
import { SignOutIcon as SignOutBase } from "@phosphor-icons/react/dist/ssr/SignOut"
import { SlidersHorizontalIcon as SlidersHorizontalBase } from "@phosphor-icons/react/dist/ssr/SlidersHorizontal"
import { SquareIcon as SquareBase } from "@phosphor-icons/react/dist/ssr/Square"
import { SquaresFourIcon as SquaresFourBase } from "@phosphor-icons/react/dist/ssr/SquaresFour"
import { StopCircleIcon as StopCircleBase } from "@phosphor-icons/react/dist/ssr/StopCircle"
import { SunIcon as SunBase } from "@phosphor-icons/react/dist/ssr/Sun"
import { TerminalIcon as TerminalBase } from "@phosphor-icons/react/dist/ssr/Terminal"
import { TerminalWindowIcon as TerminalWindowBase } from "@phosphor-icons/react/dist/ssr/TerminalWindow"
import { TrashIcon as TrashBase } from "@phosphor-icons/react/dist/ssr/Trash"
import { TextBIcon as TextBBase } from "@phosphor-icons/react/dist/ssr/TextB"
import { TextHOneIcon as TextHOneBase } from "@phosphor-icons/react/dist/ssr/TextHOne"
import { TextHThreeIcon as TextHThreeBase } from "@phosphor-icons/react/dist/ssr/TextHThree"
import { TextHTwoIcon as TextHTwoBase } from "@phosphor-icons/react/dist/ssr/TextHTwo"
import { TextItalicIcon as TextItalicBase } from "@phosphor-icons/react/dist/ssr/TextItalic"
import { TextStrikethroughIcon as TextStrikethroughBase } from "@phosphor-icons/react/dist/ssr/TextStrikethrough"
import { TextTIcon as TextTBase } from "@phosphor-icons/react/dist/ssr/TextT"
import { WarningIcon as WarningBase } from "@phosphor-icons/react/dist/ssr/Warning"
import { WarningCircleIcon as WarningCircleBase } from "@phosphor-icons/react/dist/ssr/WarningCircle"
import { XIcon as XBase } from "@phosphor-icons/react/dist/ssr/X"
import { XCircleIcon as XCircleBase } from "@phosphor-icons/react/dist/ssr/XCircle"

export type { Icon, IconProps }

/**
 * The app's icon set: Phosphor at its Light weight, switching to Regular when
 * the icon renders at 16px or smaller. Phosphor's lines scale with the icon,
 * so Light's line is 0.56px at the 12px toolbar size, too faint to read;
 * Regular's is 0.75px. The icon carries both weights and a container query
 * (`.ph-dual` in globals.css) shows the one that fits its rendered size, so
 * sizing classes on the icon or its parent pick the weight with no extra prop.
 *
 * Each export also keeps lucide-react's old defaults: 24px when no size class
 * applies, hidden from assistive tech unless it is labelled, and a class
 * naming the glyph (`ph-caret-down`) that tests and the screenshot harness can
 * select. Passing `weight` pins that weight at every size.
 *
 * Dot glyphs (the ⋯ menu, the drag grip) have no stroke to thin out: their
 * weight only sets the dot size, and Light's dots vanish at 12–16px. They
 * default to Bold, whose dots are about the size Lucide's were.
 *
 * Icons come from the per-icon SSR entry points, so they render in server
 * components and never load Phosphor's full barrel.
 */
function phosphor(
  Base: Icon,
  name: string,
  weight?: IconProps["weight"]
): Icon {
  const Wrapped = React.forwardRef<SVGSVGElement, IconProps>((props, ref) => {
    const labelled =
      props.alt != null ||
      props["aria-label"] != null ||
      props["aria-labelledby"] != null
    const pinned = props.weight ?? weight
    return (
      <Base
        ref={ref}
        size={24}
        weight={pinned ?? "light"}
        aria-hidden={labelled ? undefined : true}
        {...props}
        className={cn(name, !pinned && "ph-dual", props.className)}
      >
        {!pinned && (
          // Fills the outer icon. The size must be the width/height
          // attributes: browsers ignore CSS width on a nested svg, so a style
          // alone left Phosphor's 1em (16 of 256 user units, under 1px). The
          // inline style still beats a parent's `[&_svg]:size-*` where the
          // CSS does apply.
          <Base
            weight="regular"
            color={props.color}
            size="100%"
            style={{ width: "100%", height: "100%" }}
          />
        )}
      </Base>
    )
  })
  Wrapped.displayName = Base.displayName
  return Wrapped
}

export const AppWindowIcon = phosphor(AppWindowBase, "ph-app-window")
export const ArchiveIcon = phosphor(ArchiveBase, "ph-archive")
export const ArrowClockwiseIcon = phosphor(
  ArrowClockwiseBase,
  "ph-arrow-clockwise"
)
export const ArrowCounterClockwiseIcon = phosphor(
  ArrowCounterClockwiseBase,
  "ph-arrow-counter-clockwise"
)
export const ArrowDownIcon = phosphor(ArrowDownBase, "ph-arrow-down")
export const ArrowLeftIcon = phosphor(ArrowLeftBase, "ph-arrow-left")
export const ArrowRightIcon = phosphor(ArrowRightBase, "ph-arrow-right")
export const ArrowSquareOutIcon = phosphor(
  ArrowSquareOutBase,
  "ph-arrow-square-out"
)
export const ArrowUUpLeftIcon = phosphor(ArrowUUpLeftBase, "ph-arrow-u-up-left")
export const ArrowUpIcon = phosphor(ArrowUpBase, "ph-arrow-up")
export const ArrowUpRightIcon = phosphor(ArrowUpRightBase, "ph-arrow-up-right")
export const ArrowsClockwiseIcon = phosphor(
  ArrowsClockwiseBase,
  "ph-arrows-clockwise"
)
export const ArrowsDownUpIcon = phosphor(ArrowsDownUpBase, "ph-arrows-down-up")
export const ArrowsMergeIcon = phosphor(ArrowsMergeBase, "ph-arrows-merge")
export const ArrowsOutCardinalIcon = phosphor(
  ArrowsOutCardinalBase,
  "ph-arrows-out-cardinal"
)
export const ArrowsOutSimpleIcon = phosphor(
  ArrowsOutSimpleBase,
  "ph-arrows-out-simple"
)
export const BookBookmarkIcon = phosphor(BookBookmarkBase, "ph-book-bookmark")
export const BookOpenIcon = phosphor(BookOpenBase, "ph-book-open")
export const BracketsCurlyIcon = phosphor(
  BracketsCurlyBase,
  "ph-brackets-curly"
)
export const BroadcastIcon = phosphor(BroadcastBase, "ph-broadcast")
export const CaretDownIcon = phosphor(CaretDownBase, "ph-caret-down")
export const CaretLeftIcon = phosphor(CaretLeftBase, "ph-caret-left")
export const CaretRightIcon = phosphor(CaretRightBase, "ph-caret-right")
export const CaretUpIcon = phosphor(CaretUpBase, "ph-caret-up")
export const CaretUpDownIcon = phosphor(CaretUpDownBase, "ph-caret-up-down")
export const ChatIcon = phosphor(ChatBase, "ph-chat")
export const ChatCircleIcon = phosphor(ChatCircleBase, "ph-chat-circle")
export const ChatSlashIcon = phosphor(ChatSlashBase, "ph-chat-slash")
export const ChatTextIcon = phosphor(ChatTextBase, "ph-chat-text")
export const ChatsIcon = phosphor(ChatsBase, "ph-chats")
export const CheckIcon = phosphor(CheckBase, "ph-check")
export const CheckCircleIcon = phosphor(CheckCircleBase, "ph-check-circle")
export const CircleIcon = phosphor(CircleBase, "ph-circle")
export const CircleDashedIcon = phosphor(CircleDashedBase, "ph-circle-dashed")
export const CircleNotchIcon = phosphor(CircleNotchBase, "ph-circle-notch")
export const ClipboardTextIcon = phosphor(
  ClipboardTextBase,
  "ph-clipboard-text"
)
export const ClockIcon = phosphor(ClockBase, "ph-clock")
export const ClockCounterClockwiseIcon = phosphor(
  ClockCounterClockwiseBase,
  "ph-clock-counter-clockwise"
)
export const CodeIcon = phosphor(CodeBase, "ph-code")
export const CodeBlockIcon = phosphor(CodeBlockBase, "ph-code-block")
export const CopyIcon = phosphor(CopyBase, "ph-copy")
export const CrosshairIcon = phosphor(CrosshairBase, "ph-crosshair")
export const CursorIcon = phosphor(CursorBase, "ph-cursor")
export const DeviceMobileIcon = phosphor(DeviceMobileBase, "ph-device-mobile")
export const DeviceTabletIcon = phosphor(DeviceTabletBase, "ph-device-tablet")
export const DevicesIcon = phosphor(DevicesBase, "ph-devices")
export const DotsSixVerticalIcon = phosphor(
  DotsSixVerticalBase,
  "ph-dots-six-vertical",
  "bold"
)
export const DotsThreeIcon = phosphor(DotsThreeBase, "ph-dots-three", "bold")
export const EyeIcon = phosphor(EyeBase, "ph-eye")
export const EyeSlashIcon = phosphor(EyeSlashBase, "ph-eye-slash")
export const DownloadSimpleIcon = phosphor(
  DownloadSimpleBase,
  "ph-download-simple"
)
export const FileIcon = phosphor(FileBase, "ph-file")
export const FileCodeIcon = phosphor(FileCodeBase, "ph-file-code")
export const FileImageIcon = phosphor(FileImageBase, "ph-file-image")
export const FilePdfIcon = phosphor(FilePdfBase, "ph-file-pdf")
export const FilePlusIcon = phosphor(FilePlusBase, "ph-file-plus")
export const FileTextIcon = phosphor(FileTextBase, "ph-file-text")
export const FilesIcon = phosphor(FilesBase, "ph-files")
export const FolderIcon = phosphor(FolderBase, "ph-folder")
export const FolderLockIcon = phosphor(FolderLockBase, "ph-folder-lock")
export const FolderOpenIcon = phosphor(FolderOpenBase, "ph-folder-open")
export const FolderPlusIcon = phosphor(FolderPlusBase, "ph-folder-plus")
export const FolderSimpleIcon = phosphor(FolderSimpleBase, "ph-folder-simple")
export const FunnelSimpleIcon = phosphor(FunnelSimpleBase, "ph-funnel-simple")
export const GearIcon = phosphor(GearBase, "ph-gear")
export const GitBranchIcon = phosphor(GitBranchBase, "ph-git-branch")
export const GitDiffIcon = phosphor(GitDiffBase, "ph-git-diff")
export const GitForkIcon = phosphor(GitForkBase, "ph-git-fork")
export const GitMergeIcon = phosphor(GitMergeBase, "ph-git-merge")
export const GitPullRequestIcon = phosphor(
  GitPullRequestBase,
  "ph-git-pull-request"
)
export const GlobeIcon = phosphor(GlobeBase, "ph-globe")
export const InfoIcon = phosphor(InfoBase, "ph-info")
export const FrameCornersIcon = phosphor(FrameCornersBase, "ph-frame-corners")
export const LayoutIcon = phosphor(LayoutBase, "ph-layout")
export const LightbulbIcon = phosphor(LightbulbBase, "ph-lightbulb")
export const LinkSimpleHorizontalIcon = phosphor(
  LinkSimpleHorizontalBase,
  "ph-link-simple-horizontal"
)
export const ListBulletsIcon = phosphor(ListBulletsBase, "ph-list-bullets")
export const ListDashesIcon = phosphor(ListDashesBase, "ph-list-dashes")
export const ListNumbersIcon = phosphor(ListNumbersBase, "ph-list-numbers")
export const MagnifyingGlassIcon = phosphor(
  MagnifyingGlassBase,
  "ph-magnifying-glass"
)
export const MinusIcon = phosphor(MinusBase, "ph-minus")
export const MonitorIcon = phosphor(MonitorBase, "ph-monitor")
export const MoonIcon = phosphor(MoonBase, "ph-moon")
export const NavigationArrowIcon = phosphor(
  NavigationArrowBase,
  "ph-navigation-arrow"
)
export const NotepadIcon = phosphor(NotepadBase, "ph-notepad")
export const NotePencilIcon = phosphor(NotePencilBase, "ph-note-pencil")
export const PathIcon = phosphor(PathBase, "ph-path")
export const PauseCircleIcon = phosphor(PauseCircleBase, "ph-pause-circle")
export const PencilSimpleIcon = phosphor(PencilSimpleBase, "ph-pencil-simple")
export const PencilSimpleLineIcon = phosphor(
  PencilSimpleLineBase,
  "ph-pencil-simple-line"
)
export const PlayIcon = phosphor(PlayBase, "ph-play")
export const PlugIcon = phosphor(PlugBase, "ph-plug")
export const PlusIcon = phosphor(PlusBase, "ph-plus")
export const PushPinIcon = phosphor(PushPinBase, "ph-push-pin")
export const PushPinSlashIcon = phosphor(PushPinSlashBase, "ph-push-pin-slash")
export const QuestionIcon = phosphor(QuestionBase, "ph-question")
export const QuotesIcon = phosphor(QuotesBase, "ph-quotes")
export const RecycleIcon = phosphor(RecycleBase, "ph-recycle")
export const RobotIcon = phosphor(RobotBase, "ph-robot")
export const RowsIcon = phosphor(RowsBase, "ph-rows")
export const ScanIcon = phosphor(ScanBase, "ph-scan")
export const ScribbleIcon = phosphor(ScribbleBase, "ph-scribble")
export const ScrollIcon = phosphor(ScrollBase, "ph-scroll")
export const SelectionIcon = phosphor(SelectionBase, "ph-selection")
export const ShareNetworkIcon = phosphor(ShareNetworkBase, "ph-share-network")
export const SidebarSimpleIcon = phosphor(
  SidebarSimpleBase,
  "ph-sidebar-simple"
)
export const SignOutIcon = phosphor(SignOutBase, "ph-sign-out")
export const SlidersHorizontalIcon = phosphor(
  SlidersHorizontalBase,
  "ph-sliders-horizontal"
)
export const SquareIcon = phosphor(SquareBase, "ph-square")
export const SquaresFourIcon = phosphor(SquaresFourBase, "ph-squares-four")
export const StopCircleIcon = phosphor(StopCircleBase, "ph-stop-circle")
export const SunIcon = phosphor(SunBase, "ph-sun")
export const TerminalIcon = phosphor(TerminalBase, "ph-terminal")
export const TerminalWindowIcon = phosphor(
  TerminalWindowBase,
  "ph-terminal-window"
)
export const TrashIcon = phosphor(TrashBase, "ph-trash")
export const TextBIcon = phosphor(TextBBase, "ph-text-b")
export const TextHOneIcon = phosphor(TextHOneBase, "ph-text-h-one")
export const TextHThreeIcon = phosphor(TextHThreeBase, "ph-text-h-three")
export const TextHTwoIcon = phosphor(TextHTwoBase, "ph-text-h-two")
export const TextItalicIcon = phosphor(TextItalicBase, "ph-text-italic")
export const TextStrikethroughIcon = phosphor(
  TextStrikethroughBase,
  "ph-text-strikethrough"
)
export const TextTIcon = phosphor(TextTBase, "ph-text-t")
export const WarningIcon = phosphor(WarningBase, "ph-warning")
export const WarningCircleIcon = phosphor(
  WarningCircleBase,
  "ph-warning-circle"
)
export const XIcon = phosphor(XBase, "ph-x")
export const XCircleIcon = phosphor(XCircleBase, "ph-x-circle")
