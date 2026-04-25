"use client"

import { useMemo } from "react"
import { SlidersHorizontal } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
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
}

export function KnobsPopover({ knobs, values, onChange }: KnobsPopoverProps) {
  const defs = useMemo<KnobDef[]>(() => {
    if (!knobs) return []
    return knobs.filter(isKnobDef)
  }, [knobs])

  if (defs.length === 0) return null

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

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex h-5 w-5 items-center justify-center rounded-sm border border-border bg-background text-muted-foreground transition-colors hover:bg-muted"
          title="Adjust knobs"
        >
          <SlidersHorizontal className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-72 gap-3">
        {defs.map((def) => (
          <KnobControl
            key={def.id}
            def={def}
            value={coerceKnobValue(def, values?.[def.id])}
            onChange={(v) => setValue(def.id, v)}
          />
        ))}
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
