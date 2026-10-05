"use client"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { cn } from "@workspace/ui/lib/utils"
import {
  IFRAME_LAYER_SIZE_CATEGORY_ICONS,
  GROUPED_IFRAME_LAYER_SIZE_PRESETS,
  formatIframeLayerSize,
  getIframeLayerSizePreset,
} from "@/lib/iframe-layer-sizes"

interface IframeLayerSizeSelectProps {
  id?: string
  value: string
  onChange: (value: string) => void
  size?: "sm" | "default"
  className?: string
}

export function IframeLayerSizeSelect({
  id,
  value,
  onChange,
  size = "default",
  className,
}: IframeLayerSizeSelectProps) {
  const selected = getIframeLayerSizePreset(value)
  const SelectedIcon = IFRAME_LAYER_SIZE_CATEGORY_ICONS[selected.category]

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        id={id}
        size={size}
        // The trigger clamps its value with `-webkit-box`, which WebKit (the
        // desktop app) sizes from the row's min-content and so cut the name
        // short. The row is one line anyway; lay it out as plain flex.
        className={cn("[&>span]:line-clamp-none", className)}
      >
        <SelectValue>
          <span className="flex items-center gap-2 whitespace-nowrap">
            <SelectedIcon className="size-4 text-muted-foreground" />
            <span>{selected.label}</span>
            <span className="text-muted-foreground tabular-nums">
              {formatIframeLayerSize(selected)}
            </span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent position="item-aligned">
        {GROUPED_IFRAME_LAYER_SIZE_PRESETS.map((group, index) => {
          const Icon = IFRAME_LAYER_SIZE_CATEGORY_ICONS[group.category]
          return (
            <SelectGroup key={group.category}>
              {index > 0 && <SelectSeparator />}
              <SelectLabel>{group.category}</SelectLabel>
              {group.presets.map((preset) => (
                <SelectItem
                  key={preset.id}
                  value={preset.id}
                  // Stretch the item text so the size column lines up.
                  className="[&>span:last-child]:flex-1"
                >
                  <span className="flex w-full items-center gap-2">
                    <Icon className="size-4 text-muted-foreground" />
                    <span>{preset.label}</span>
                    <span className="ml-auto pl-4 text-xs text-muted-foreground tabular-nums">
                      {formatIframeLayerSize(preset)}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          )
        })}
      </SelectContent>
    </Select>
  )
}
