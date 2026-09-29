import * as React from "react"
import type { Icon, IconProps } from "@phosphor-icons/react"

import { cn } from "@workspace/ui/lib/utils"

import { AppWindowIcon as AppWindowBase } from "@phosphor-icons/react/dist/ssr/AppWindow"
import { ArchiveIcon as ArchiveBase } from "@phosphor-icons/react/dist/ssr/Archive"
import { ArrowClockwiseIcon as ArrowClockwiseBase } from "@phosphor-icons/react/dist/ssr/ArrowClockwise"
import { ArrowCounterClockwiseIcon as ArrowCounterClockwiseBase } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise"
import { ArrowDownIcon as ArrowDownBase } from "@phosphor-icons/react/dist/ssr/ArrowDown"
import { ArrowLeftIcon as ArrowLeftBase } from "@phosphor-icons/react/dist/ssr/ArrowLeft"
import { ArrowSquareOutIcon as ArrowSquareOutBase } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut"
import { ArrowUUpLeftIcon as ArrowUUpLeftBase } from "@phosphor-icons/react/dist/ssr/ArrowUUpLeft"
import { ArrowUpIcon as ArrowUpBase } from "@phosphor-icons/react/dist/ssr/ArrowUp"
import { ArrowUpRightIcon as ArrowUpRightBase } from "@phosphor-icons/react/dist/ssr/ArrowUpRight"
import { ArrowsClockwiseIcon as ArrowsClockwiseBase } from "@phosphor-icons/react/dist/ssr/ArrowsClockwise"
import { ArrowsMergeIcon as ArrowsMergeBase } from "@phosphor-icons/react/dist/ssr/ArrowsMerge"
import { ArrowsOutCardinalIcon as ArrowsOutCardinalBase } from "@phosphor-icons/react/dist/ssr/ArrowsOutCardinal"
import { ArrowsOutSimpleIcon as ArrowsOutSimpleBase } from "@phosphor-icons/react/dist/ssr/ArrowsOutSimple"
import { BookBookmarkIcon as BookBookmarkBase } from "@phosphor-icons/react/dist/ssr/BookBookmark"
import { BookOpenIcon as BookOpenBase } from "@phosphor-icons/react/dist/ssr/BookOpen"
import { BracketsCurlyIcon as BracketsCurlyBase } from "@phosphor-icons/react/dist/ssr/BracketsCurly"
import { BrainIcon as BrainBase } from "@phosphor-icons/react/dist/ssr/Brain"
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
import { FrameCornersIcon as FrameCornersBase } from "@phosphor-icons/react/dist/ssr/FrameCorners"
import { LayoutIcon as LayoutBase } from "@phosphor-icons/react/dist/ssr/Layout"
import { LinkSimpleHorizontalIcon as LinkSimpleHorizontalBase } from "@phosphor-icons/react/dist/ssr/LinkSimpleHorizontal"
import { ListBulletsIcon as ListBulletsBase } from "@phosphor-icons/react/dist/ssr/ListBullets"
import { ListDashesIcon as ListDashesBase } from "@phosphor-icons/react/dist/ssr/ListDashes"
import { ListNumbersIcon as ListNumbersBase } from "@phosphor-icons/react/dist/ssr/ListNumbers"
import { MagnifyingGlassIcon as MagnifyingGlassBase } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass"
import { MinusIcon as MinusBase } from "@phosphor-icons/react/dist/ssr/Minus"
import { MonitorIcon as MonitorBase } from "@phosphor-icons/react/dist/ssr/Monitor"
import { MoonIcon as MoonBase } from "@phosphor-icons/react/dist/ssr/Moon"
import { NavigationArrowIcon as NavigationArrowBase } from "@phosphor-icons/react/dist/ssr/NavigationArrow"
import { NotePencilIcon as NotePencilBase } from "@phosphor-icons/react/dist/ssr/NotePencil"
import { PaletteIcon as PaletteBase } from "@phosphor-icons/react/dist/ssr/Palette"
import { PathIcon as PathBase } from "@phosphor-icons/react/dist/ssr/Path"
import { PauseCircleIcon as PauseCircleBase } from "@phosphor-icons/react/dist/ssr/PauseCircle"
import { PencilSimpleIcon as PencilSimpleBase } from "@phosphor-icons/react/dist/ssr/PencilSimple"
import { PencilSimpleLineIcon as PencilSimpleLineBase } from "@phosphor-icons/react/dist/ssr/PencilSimpleLine"
import { PlayIcon as PlayBase } from "@phosphor-icons/react/dist/ssr/Play"
import { PlugIcon as PlugBase } from "@phosphor-icons/react/dist/ssr/Plug"
import { PlusIcon as PlusBase } from "@phosphor-icons/react/dist/ssr/Plus"
import { PushPinIcon as PushPinBase } from "@phosphor-icons/react/dist/ssr/PushPin"
import { PushPinSlashIcon as PushPinSlashBase } from "@phosphor-icons/react/dist/ssr/PushPinSlash"
import { QuotesIcon as QuotesBase } from "@phosphor-icons/react/dist/ssr/Quotes"
import { RecycleIcon as RecycleBase } from "@phosphor-icons/react/dist/ssr/Recycle"
import { RobotIcon as RobotBase } from "@phosphor-icons/react/dist/ssr/Robot"
import { ScanIcon as ScanBase } from "@phosphor-icons/react/dist/ssr/Scan"
import { ScrollIcon as ScrollBase } from "@phosphor-icons/react/dist/ssr/Scroll"
import { SelectionIcon as SelectionBase } from "@phosphor-icons/react/dist/ssr/Selection"
import { ShareNetworkIcon as ShareNetworkBase } from "@phosphor-icons/react/dist/ssr/ShareNetwork"
import { SidebarSimpleIcon as SidebarSimpleBase } from "@phosphor-icons/react/dist/ssr/SidebarSimple"
import { SignOutIcon as SignOutBase } from "@phosphor-icons/react/dist/ssr/SignOut"
import { SlidersHorizontalIcon as SlidersHorizontalBase } from "@phosphor-icons/react/dist/ssr/SlidersHorizontal"
import { SparkleIcon as SparkleBase } from "@phosphor-icons/react/dist/ssr/Sparkle"
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
 * The app's icon set: Phosphor at its Light weight. Each export wraps the
 * Phosphor icon so it draws Light by default and keeps lucide-react's old
 * defaults: 24px when no size class applies, hidden from assistive tech unless
 * it is labelled, and a class naming the glyph (`ph-caret-down`) that tests
 * and the screenshot harness can select. Pass `weight` to override the weight
 * for one glyph.
 *
 * Light lines get a constant extra width (see LIGHT_COMPENSATION) so small
 * icons stay legible.
 *
 * Dot glyphs (the ⋯ menu, the drag grip) have no stroke to thin out: their
 * weight only sets the dot size, and Light's dots vanish at 12–16px. They
 * default to Bold, whose dots are about the size Lucide's were.
 *
 * Icons come from the per-icon SSR entry points, so they render in server
 * components and never load Phosphor's full barrel.
 */
/**
 * Screen pixels added to every Light line, like Lucide's `absoluteStrokeWidth`.
 * Phosphor draws its lines as filled outlines that scale with the icon, so
 * Light's line is 0.56px at 12px: too faint for toolbar glyphs. A thin
 * non-scaling stroke around each outline thickens every line by the same
 * amount at any size (about 0.9px at 12px, 1.1px at 16px) while large icons
 * keep Light's look.
 */
const LIGHT_COMPENSATION = 0.35

function light(
  Base: Icon,
  name: string,
  weight: IconProps["weight"] = "light"
): Icon {
  const Light = React.forwardRef<SVGSVGElement, IconProps>((props, ref) => {
    const labelled =
      props.alt != null ||
      props["aria-label"] != null ||
      props["aria-labelledby"] != null
    const compensate = (props.weight ?? weight) === "light"
    return (
      <Base
        ref={ref}
        size={24}
        weight={weight}
        aria-hidden={labelled ? undefined : true}
        {...(compensate && {
          stroke: props.color ?? "currentColor",
          strokeWidth: LIGHT_COMPENSATION,
          strokeLinejoin: "round" as const,
        })}
        {...props}
        className={cn(
          name,
          compensate && "[&_path]:[vector-effect:non-scaling-stroke]",
          props.className
        )}
      />
    )
  })
  Light.displayName = Base.displayName
  return Light
}

export const AppWindowIcon = light(AppWindowBase, "ph-app-window")
export const ArchiveIcon = light(ArchiveBase, "ph-archive")
export const ArrowClockwiseIcon = light(
  ArrowClockwiseBase,
  "ph-arrow-clockwise"
)
export const ArrowCounterClockwiseIcon = light(
  ArrowCounterClockwiseBase,
  "ph-arrow-counter-clockwise"
)
export const ArrowDownIcon = light(ArrowDownBase, "ph-arrow-down")
export const ArrowLeftIcon = light(ArrowLeftBase, "ph-arrow-left")
export const ArrowSquareOutIcon = light(
  ArrowSquareOutBase,
  "ph-arrow-square-out"
)
export const ArrowUUpLeftIcon = light(ArrowUUpLeftBase, "ph-arrow-u-up-left")
export const ArrowUpIcon = light(ArrowUpBase, "ph-arrow-up")
export const ArrowUpRightIcon = light(ArrowUpRightBase, "ph-arrow-up-right")
export const ArrowsClockwiseIcon = light(
  ArrowsClockwiseBase,
  "ph-arrows-clockwise"
)
export const ArrowsMergeIcon = light(ArrowsMergeBase, "ph-arrows-merge")
export const ArrowsOutCardinalIcon = light(
  ArrowsOutCardinalBase,
  "ph-arrows-out-cardinal"
)
export const ArrowsOutSimpleIcon = light(
  ArrowsOutSimpleBase,
  "ph-arrows-out-simple"
)
export const BookBookmarkIcon = light(BookBookmarkBase, "ph-book-bookmark")
export const BookOpenIcon = light(BookOpenBase, "ph-book-open")
export const BracketsCurlyIcon = light(BracketsCurlyBase, "ph-brackets-curly")
export const BrainIcon = light(BrainBase, "ph-brain")
export const CaretDownIcon = light(CaretDownBase, "ph-caret-down")
export const CaretLeftIcon = light(CaretLeftBase, "ph-caret-left")
export const CaretRightIcon = light(CaretRightBase, "ph-caret-right")
export const CaretUpIcon = light(CaretUpBase, "ph-caret-up")
export const CaretUpDownIcon = light(CaretUpDownBase, "ph-caret-up-down")
export const ChatIcon = light(ChatBase, "ph-chat")
export const ChatCircleIcon = light(ChatCircleBase, "ph-chat-circle")
export const ChatSlashIcon = light(ChatSlashBase, "ph-chat-slash")
export const ChatTextIcon = light(ChatTextBase, "ph-chat-text")
export const ChatsIcon = light(ChatsBase, "ph-chats")
export const CheckIcon = light(CheckBase, "ph-check")
export const CheckCircleIcon = light(CheckCircleBase, "ph-check-circle")
export const CircleIcon = light(CircleBase, "ph-circle")
export const CircleDashedIcon = light(CircleDashedBase, "ph-circle-dashed")
export const CircleNotchIcon = light(CircleNotchBase, "ph-circle-notch")
export const ClipboardTextIcon = light(ClipboardTextBase, "ph-clipboard-text")
export const ClockIcon = light(ClockBase, "ph-clock")
export const ClockCounterClockwiseIcon = light(
  ClockCounterClockwiseBase,
  "ph-clock-counter-clockwise"
)
export const CodeIcon = light(CodeBase, "ph-code")
export const CodeBlockIcon = light(CodeBlockBase, "ph-code-block")
export const CopyIcon = light(CopyBase, "ph-copy")
export const CrosshairIcon = light(CrosshairBase, "ph-crosshair")
export const CursorIcon = light(CursorBase, "ph-cursor")
export const DeviceMobileIcon = light(DeviceMobileBase, "ph-device-mobile")
export const DeviceTabletIcon = light(DeviceTabletBase, "ph-device-tablet")
export const DevicesIcon = light(DevicesBase, "ph-devices")
export const DotsSixVerticalIcon = light(
  DotsSixVerticalBase,
  "ph-dots-six-vertical",
  "bold"
)
export const DotsThreeIcon = light(DotsThreeBase, "ph-dots-three", "bold")
export const EyeIcon = light(EyeBase, "ph-eye")
export const EyeSlashIcon = light(EyeSlashBase, "ph-eye-slash")
export const FilePlusIcon = light(FilePlusBase, "ph-file-plus")
export const FileTextIcon = light(FileTextBase, "ph-file-text")
export const FilesIcon = light(FilesBase, "ph-files")
export const FolderIcon = light(FolderBase, "ph-folder")
export const FolderLockIcon = light(FolderLockBase, "ph-folder-lock")
export const FolderOpenIcon = light(FolderOpenBase, "ph-folder-open")
export const FolderPlusIcon = light(FolderPlusBase, "ph-folder-plus")
export const FolderSimpleIcon = light(FolderSimpleBase, "ph-folder-simple")
export const FunnelSimpleIcon = light(FunnelSimpleBase, "ph-funnel-simple")
export const GearIcon = light(GearBase, "ph-gear")
export const GitBranchIcon = light(GitBranchBase, "ph-git-branch")
export const GitDiffIcon = light(GitDiffBase, "ph-git-diff")
export const GitForkIcon = light(GitForkBase, "ph-git-fork")
export const GitMergeIcon = light(GitMergeBase, "ph-git-merge")
export const GitPullRequestIcon = light(
  GitPullRequestBase,
  "ph-git-pull-request"
)
export const GlobeIcon = light(GlobeBase, "ph-globe")
export const FrameCornersIcon = light(FrameCornersBase, "ph-frame-corners")
export const LayoutIcon = light(LayoutBase, "ph-layout")
export const LinkSimpleHorizontalIcon = light(
  LinkSimpleHorizontalBase,
  "ph-link-simple-horizontal"
)
export const ListBulletsIcon = light(ListBulletsBase, "ph-list-bullets")
export const ListDashesIcon = light(ListDashesBase, "ph-list-dashes")
export const ListNumbersIcon = light(ListNumbersBase, "ph-list-numbers")
export const MagnifyingGlassIcon = light(
  MagnifyingGlassBase,
  "ph-magnifying-glass"
)
export const MinusIcon = light(MinusBase, "ph-minus")
export const MonitorIcon = light(MonitorBase, "ph-monitor")
export const MoonIcon = light(MoonBase, "ph-moon")
export const NavigationArrowIcon = light(
  NavigationArrowBase,
  "ph-navigation-arrow"
)
export const NotePencilIcon = light(NotePencilBase, "ph-note-pencil")
export const PaletteIcon = light(PaletteBase, "ph-palette")
export const PathIcon = light(PathBase, "ph-path")
export const PauseCircleIcon = light(PauseCircleBase, "ph-pause-circle")
export const PencilSimpleIcon = light(PencilSimpleBase, "ph-pencil-simple")
export const PencilSimpleLineIcon = light(
  PencilSimpleLineBase,
  "ph-pencil-simple-line"
)
export const PlayIcon = light(PlayBase, "ph-play")
export const PlugIcon = light(PlugBase, "ph-plug")
export const PlusIcon = light(PlusBase, "ph-plus")
export const PushPinIcon = light(PushPinBase, "ph-push-pin")
export const PushPinSlashIcon = light(PushPinSlashBase, "ph-push-pin-slash")
export const QuotesIcon = light(QuotesBase, "ph-quotes")
export const RecycleIcon = light(RecycleBase, "ph-recycle")
export const RobotIcon = light(RobotBase, "ph-robot")
export const ScanIcon = light(ScanBase, "ph-scan")
export const ScrollIcon = light(ScrollBase, "ph-scroll")
export const SelectionIcon = light(SelectionBase, "ph-selection")
export const ShareNetworkIcon = light(ShareNetworkBase, "ph-share-network")
export const SidebarSimpleIcon = light(SidebarSimpleBase, "ph-sidebar-simple")
export const SignOutIcon = light(SignOutBase, "ph-sign-out")
export const SlidersHorizontalIcon = light(
  SlidersHorizontalBase,
  "ph-sliders-horizontal"
)
export const SparkleIcon = light(SparkleBase, "ph-sparkle")
export const SquareIcon = light(SquareBase, "ph-square")
export const SquaresFourIcon = light(SquaresFourBase, "ph-squares-four")
export const StopCircleIcon = light(StopCircleBase, "ph-stop-circle")
export const SunIcon = light(SunBase, "ph-sun")
export const TerminalIcon = light(TerminalBase, "ph-terminal")
export const TerminalWindowIcon = light(
  TerminalWindowBase,
  "ph-terminal-window"
)
export const TrashIcon = light(TrashBase, "ph-trash")
export const TextBIcon = light(TextBBase, "ph-text-b")
export const TextHOneIcon = light(TextHOneBase, "ph-text-h-one")
export const TextHThreeIcon = light(TextHThreeBase, "ph-text-h-three")
export const TextHTwoIcon = light(TextHTwoBase, "ph-text-h-two")
export const TextItalicIcon = light(TextItalicBase, "ph-text-italic")
export const TextStrikethroughIcon = light(
  TextStrikethroughBase,
  "ph-text-strikethrough"
)
export const TextTIcon = light(TextTBase, "ph-text-t")
export const WarningIcon = light(WarningBase, "ph-warning")
export const WarningCircleIcon = light(WarningCircleBase, "ph-warning-circle")
export const XIcon = light(XBase, "ph-x")
export const XCircleIcon = light(XCircleBase, "ph-x-circle")
