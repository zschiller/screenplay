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
import {
  IFRAME_LAYER_SIZE_CATEGORY_ICONS,
  GROUPED_IFRAME_LAYER_SIZE_PRESETS,
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
      <SelectTrigger id={id} size={size} className={className}>
        <SelectValue>
          <span className="flex items-center gap-2">
            <SelectedIcon className="size-4 text-muted-foreground" />
            <span className="truncate">{selected.label}</span>
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
                <SelectItem key={preset.id} value={preset.id}>
                  <span className="flex items-center gap-2">
                    <Icon className="size-4 text-muted-foreground" />
                    <span>{preset.label}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {preset.width}×{preset.height}
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
