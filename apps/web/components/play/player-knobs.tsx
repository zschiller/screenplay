"use client"

import { useMemo } from "react"
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

interface PlayerKnobsProps {
  knobs: JsonValue[]
  values: JsonObject
  onChange: (next: KnobValues) => void
}

export function PlayerKnobs({ knobs, values, onChange }: PlayerKnobsProps) {
  const defs = useMemo<KnobDef[]>(() => knobs.filter(isKnobDef), [knobs])

  const hasOverrides = useMemo(() => {
    for (const def of defs) {
      if (coerceKnobValue(def, values[def.id]) !== def.default) return true
    }
    return false
  }, [defs, values])

  function setValue(id: string, next: KnobValue) {
    const merged: KnobValues = { [id]: next }
    for (const def of defs) {
      if (def.id === id) continue
      merged[def.id] = coerceKnobValue(def, values[def.id])
    }
    onChange(merged)
  }

  function resetAll() {
    const next: KnobValues = {}
    for (const def of defs) next[def.id] = def.default
    onChange(next)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <span className="text-xs font-medium text-foreground">Knobs</span>
        <Button
          size="xxs"
          variant="ghost"
          disabled={!hasOverrides}
          onClick={resetAll}
        >
          Reset
        </Button>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        {defs.length === 0 ? (
          <div className="flex flex-col gap-2 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">No knobs declared</p>
            <p>
              Call{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
                useKnob(...)
              </code>{" "}
              from{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
                @screenplay.space/knobs
              </code>{" "}
              inside this prototype to expose live controls here.
            </p>
          </div>
        ) : (
          defs.map((def) => (
            <KnobControl
              key={def.id}
              def={def}
              value={coerceKnobValue(def, values[def.id])}
              onChange={(v) => setValue(def.id, v)}
            />
          ))
        )}
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
