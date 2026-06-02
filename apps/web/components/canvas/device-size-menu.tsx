"use client"

import { Check, MonitorSmartphone } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import {
  GROUPED_IFRAME_LAYER_SIZE_PRESETS,
  IFRAME_LAYER_SIZE_CATEGORY_ICONS,
} from "@/lib/iframe-layer-sizes"

interface DeviceSizeMenuProps {
  width: number
  height: number
  onSelect: (width: number, height: number) => void
}

export function DeviceSizeMenu({
  width,
  height,
  onSelect,
}: DeviceSizeMenuProps) {
  return (
    <DropdownMenu>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button size="icon-xxs" variant="ghost">
                <MonitorSmartphone />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">Device size</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={8}
        className="w-64"
      >
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
                    <Icon className="text-muted-foreground" />
                    <span>{preset.label}</span>
                    <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                      {preset.width}×{preset.height}
                      {active ? (
                        <Check className="size-3 text-foreground" />
                      ) : null}
                    </span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuGroup>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
