"use client"

import { useMemo, type ReactNode } from "react"
import { Button } from "@workspace/ui/components/button"
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

export function knobDefs(knobs: JsonValue[] | undefined): KnobDef[] {
  return knobs ? knobs.filter(isKnobDef) : []
}

/** Whether any knob is set away from its default. */
export function hasKnobOverrides(
  defs: KnobDef[],
  values: JsonObject | undefined
): boolean {
  if (!values) return false
  return defs.some(
    (def) => coerceKnobValue(def, values[def.id]) !== def.default
  )
}

interface KnobsPanelProps {
  knobs: JsonValue[] | undefined
  values: JsonObject | undefined
  onChange: (next: KnobValues) => void
  /** Shown under the header when the prototype declares no knobs. */
  empty: ReactNode
}

/**
 * The Knobs panel shared by the canvas popover and the player HUD: a
 * "Knobs · Reset" header over the controls. It hugs its content and scrolls
 * past a max height, so the host surface sets only the width.
 */
export function KnobsPanel({
  knobs,
  values,
  onChange,
  empty,
}: KnobsPanelProps) {
  const defs = useMemo(() => knobDefs(knobs), [knobs])
  const hasOverrides = hasKnobOverrides(defs, values)

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
    <div className="flex max-h-90 min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-foreground/5 px-3">
        <span className="text-xs font-medium text-foreground">Knobs</span>
        {defs.length > 0 ? (
          <Button
            size="xxs"
            variant="ghost"
            disabled={!hasOverrides}
            onClick={resetAll}
          >
            Reset
          </Button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
        {defs.length === 0
          ? empty
          : defs.map((def) => (
              <KnobControl
                key={def.id}
                def={def}
                value={coerceKnobValue(def, values?.[def.id])}
                onChange={(v) => setValue(def.id, v)}
              />
            ))}
      </div>
    </div>
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
            className="h-7 w-24 text-xs md:text-xs"
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
            className="h-7 text-xs md:text-xs"
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
            <SelectTrigger size="sm" className="text-xs data-[size=sm]:h-7">
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
