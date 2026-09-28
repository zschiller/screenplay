"use client"

import { Check, MonitorSmartphone } from "lucide-react"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"
import {
  GROUPED_IFRAME_LAYER_SIZE_PRESETS,
  IFRAME_LAYER_SIZE_CATEGORY_ICONS,
  formatIframeLayerSize,
} from "@/lib/iframe-layer-sizes"

interface DeviceSizeSubMenuProps {
  width: number
  height: number
  onSelect: (width: number, height: number) => void
}

/**
 * The device-size presets as a submenu, embedded in the frame toolbar's `…`
 * overflow drawer. Demoted from a top-level toolbar button because dragging a
 * frame on the canvas already resize-snaps to these same device sizes — this
 * is the redundant second way in, kept for precision but out of the way.
 */
export function DeviceSizeSubMenu({
  width,
  height,
  onSelect,
}: DeviceSizeSubMenuProps) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <MonitorSmartphone />
        Device size
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {GROUPED_IFRAME_LAYER_SIZE_PRESETS.map((group, index) => {
          const Icon = IFRAME_LAYER_SIZE_CATEGORY_ICONS[group.category]
          return (
            <DropdownMenuGroup key={group.category}>
              {index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {group.category}
              </DropdownMenuLabel>
              {group.presets.map((preset) => {
                const active =
                  preset.width === width && preset.height === height
                return (
                  <DropdownMenuItem
                    key={preset.id}
                    onSelect={() => onSelect(preset.width, preset.height)}
                  >
                    <Icon />
                    <span>{preset.label}</span>
                    <span className="ml-auto flex items-center gap-1.5 pl-4 text-xs text-muted-foreground tabular-nums">
                      {formatIframeLayerSize(preset)}
                      {/* Always laid out so the sizes stay one column. */}
                      <Check
                        className={cn(
                          "size-3 text-foreground",
                          !active && "invisible"
                        )}
                      />
                    </span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuGroup>
          )
        })}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
