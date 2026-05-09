"use client"

import { useMemo, type RefObject } from "react"
import { SlidersHorizontal } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Slider } from "@workspace/ui/components/slider"
import { Switch } from "@workspace/ui/components/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  coerceKnobValue,
  isKnobDef,
  type KnobDef,
  type KnobValue,
  type KnobValues,
} from "@/lib/knobs/types"
import type { JsonObject, JsonValue } from "@/lib/postmessage-protocol"

interface KnobsPopoverProps {
  knobs: JsonValue[] | undefined
  values: JsonObject | undefined
  onChange: (values: KnobValues) => void
  /**
   * Element to anchor the popover content against. Defaults to the trigger
   * button — pass the frame element so the popover docks beside the iframeLayer
   * instead of overlapping its iframe.
   */
  anchorRef?: RefObject<HTMLElement | null>
}

export function KnobsPopover({ knobs, values, onChange, anchorRef }: KnobsPopoverProps) {
  const defs = useMemo<KnobDef[]>(() => {
    if (!knobs) return []
    return knobs.filter(isKnobDef)
  }, [knobs])

  const hasOverrides = useMemo(() => {
    if (!values) return false
    for (const def of defs) {
      if (coerceKnobValue(def, values[def.id]) !== def.default) return true
    }
    return false
  }, [defs, values])

  function setValue(id: string, next: KnobValue) {
    const merged: KnobValues = { [id]: next }
    if (values) {
      for (const def of defs) {
        if (def.id === id) continue
        merged[def.id] = coerceKnobValue(def, values[def.id])
      }
    }
    onChange(merged)
  }

  function resetAll() {
    const next: KnobValues = {}
    for (const def of defs) next[def.id] = def.default
    onChange(next)
  }

  return (
    <Popover>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                size="icon-xxs"
                variant="outline"
                className="relative"
              >
                <SlidersHorizontal />
                {hasOverrides ? (
                  <span
                    aria-hidden
                    className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-orange-500 ring-1 ring-background"
                  />
                ) : null}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Knobs</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {/* Anchor must render AFTER PopoverTrigger: on the first render the
          trigger auto-wraps in a PopperAnchor until `hasCustomAnchor` flips,
          and effects run in render order — so a leading PopoverAnchor sets
          the anchor first and then the trigger's wrapper overwrites it. */}
      {anchorRef ? (
        <PopoverAnchor
          virtualRef={anchorRef as RefObject<HTMLElement>}
        />
      ) : null}
      <PopoverContent
        side={anchorRef ? "right" : "bottom"}
        align={anchorRef ? "start" : "end"}
        sideOffset={anchorRef ? 8 : 6}
        collisionPadding={16}
        className="w-72 gap-3"
      >
        {defs.length === 0 ? (
          <div className="flex flex-col gap-2 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">No knobs yet</p>
            <p>
              Ask the model to add a knob so you can tweak this prototype live.
              For example:
            </p>
            <p className="rounded-sm border border-border bg-muted/50 p-2 italic text-foreground">
              &ldquo;Add a slider knob to control the card padding.&rdquo;
            </p>
          </div>
        ) : (
          defs.map((def) => (
            <KnobControl
              key={def.id}
              def={def}
              value={coerceKnobValue(def, values?.[def.id])}
              onChange={(v) => setValue(def.id, v)}
            />
          ))
        )}
        <Button
          size="xs"
          variant="outline"
          disabled={!hasOverrides}
          onClick={resetAll}
          className="h-6 w-full text-xs"
        >
          Reset to defaults
        </Button>
      </PopoverContent>
    </Popover>
  )
}

interface KnobControlProps {
  def: KnobDef
  value: KnobValue
  onChange: (next: KnobValue) => void
}

function KnobControl({ def, value, onChange }: KnobControlProps) {
  const label = def.label ?? def.id

  switch (def.type) {
    case "slider": {
      const numericValue = typeof value === "number" ? value : def.default
      return (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">{label}</Label>
            <span className="text-xs text-muted-foreground tabular-nums">
              {numericValue}
            </span>
          </div>
          <Slider
            min={def.min}
            max={def.max}
            step={def.step ?? 1}
            value={[numericValue]}
            onValueChange={(vals) => {
              const next = vals[0]
              if (typeof next === "number") onChange(next)
            }}
          />
        </div>
      )
    }
    case "number": {
      const numericValue = typeof value === "number" ? value : def.default
      return (
        <div className="flex items-center justify-between gap-3">
          <Label className="text-xs">{label}</Label>
          <Input
            type="number"
            value={numericValue}
            min={def.min}
            max={def.max}
            step={def.step}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (!Number.isNaN(n)) onChange(n)
            }}
            className="h-7 w-24 text-xs"
          />
        </div>
      )
    }
    case "boolean": {
      const boolValue = typeof value === "boolean" ? value : def.default
      return (
        <div className="flex items-center justify-between gap-3">
          <Label className="text-xs">{label}</Label>
          <Switch checked={boolValue} onCheckedChange={onChange} />
        </div>
      )
    }
    case "string": {
      const stringValue = typeof value === "string" ? value : def.default
      return (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">{label}</Label>
          <Input
            type="text"
            value={stringValue}
            placeholder={def.placeholder}
            onChange={(e) => onChange(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
      )
    }
    case "select": {
      const stringValue = typeof value === "string" ? value : def.default
      return (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">{label}</Label>
          <Select value={stringValue} onValueChange={onChange}>
            <SelectTrigger size="sm" className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {def.options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label ?? opt.value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
    }
    case "color": {
      const stringValue = typeof value === "string" ? value : def.default
      return (
        <div className="flex items-center justify-between gap-3">
          <Label className="text-xs">{label}</Label>
          <input
            type="color"
            value={stringValue}
            onChange={(e) => onChange(e.target.value)}
            className="h-7 w-12 cursor-pointer rounded border border-border bg-transparent"
          />
        </div>
      )
    }
  }
}
