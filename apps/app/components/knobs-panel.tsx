"use client"

import { Fragment, useMemo, useState, type ReactNode } from "react"
import { Button } from "@workspace/ui/components/button"
import { InfoIcon } from "@workspace/ui/components/icons"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Slider } from "@workspace/ui/components/slider"
import { Switch } from "@workspace/ui/components/switch"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
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
  TABS_KNOB_MAX_OPTIONS,
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

export type KnobsTheme = "light" | "dark"

const THEME_KNOB: KnobDef = {
  type: "tabs",
  id: "theme",
  label: "Theme",
  default: "light",
  options: [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ],
}

interface KnobsPanelProps {
  knobs: JsonValue[] | undefined
  values: JsonObject | undefined
  onChange: (next: KnobValues) => void
  /** Shown under the header when the prototype declares no knobs. */
  empty: ReactNode
  /** A shared frame's Theme knob, above the page's own: the colour scheme
   *  its one browser renders in, for everyone. */
  theme?: { value: KnobsTheme; onChange: (next: KnobsTheme) => void }
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
  theme,
}: KnobsPanelProps) {
  const defs = useMemo(() => knobDefs(knobs), [knobs])
  const hasOverrides =
    hasKnobOverrides(defs, values) || (!!theme && theme.value !== "light")

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
    theme?.onChange("light")
  }

  const sections = useMemo(() => knobSections(defs), [defs])

  return (
    <div className="flex max-h-90 min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-foreground/5 px-3">
        <span className="text-sm font-medium text-foreground">Knobs</span>
        {defs.length > 0 || theme ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={!hasOverrides}
            onClick={resetAll}
          >
            Reset
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 overflow-y-auto px-3 py-1.5">
        {/* One grid for every row, so all controls share a 136px column on
            the right whatever their label's length. */}
        <div className="grid grid-cols-[minmax(0,1fr)_--spacing(34)] gap-x-4">
          {theme ? (
            <KnobRow
              def={THEME_KNOB}
              value={theme.value}
              onChange={(v) => theme.onChange(v === "dark" ? "dark" : "light")}
              divided={defs.length > 0 && sections[0]?.group === undefined}
            />
          ) : null}
          {defs.length === 0 ? (
            <div className="col-span-2 py-1.5">{empty}</div>
          ) : (
            sections.map((section, s) => (
              <Fragment key={section.group ?? ""}>
                {section.group !== undefined ? (
                  <div
                    className={cn(
                      "col-span-2 flex items-end pb-1 font-mono text-xs font-normal tracking-wider text-muted-foreground uppercase",
                      s === 0 && !theme ? "h-7" : "h-10"
                    )}
                  >
                    {section.group}
                  </div>
                ) : null}
                {section.defs.map((def, i) => (
                  <KnobRow
                    key={def.id}
                    def={def}
                    value={coerceKnobValue(def, values?.[def.id])}
                    onChange={(v) => setValue(def.id, v)}
                    // Hairlines only between knobs of one group: none under
                    // a group's last knob or the panel's.
                    divided={i < section.defs.length - 1}
                  />
                ))}
              </Fragment>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

interface KnobSection {
  /** Absent for the knobs that name no group, which come first. */
  group?: string
  defs: KnobDef[]
}

/**
 * Knobs in declaration order, gathered by `group`: ungrouped knobs first,
 * then each group where its first knob was declared.
 */
export function knobSections(defs: KnobDef[]): KnobSection[] {
  const ungrouped: KnobDef[] = []
  const groups = new Map<string, KnobDef[]>()
  for (const def of defs) {
    const group = typeof def.group === "string" ? def.group.trim() : ""
    if (!group) {
      ungrouped.push(def)
      continue
    }
    const list = groups.get(group)
    if (list) list.push(def)
    else groups.set(group, [def])
  }
  const sections: KnobSection[] = []
  if (ungrouped.length > 0) sections.push({ defs: ungrouped })
  for (const [group, list] of groups) sections.push({ group, defs: list })
  return sections
}

interface KnobRowProps extends KnobControlProps {
  divided: boolean
}

/** One knob: its label (and description) on the left, its control on the right. */
function KnobRow({ def, value, onChange, divided }: KnobRowProps) {
  const label = def.label ?? def.id
  const description =
    typeof def.description === "string" ? def.description.trim() : ""
  return (
    <div
      className={cn(
        "col-span-2 grid min-h-10 grid-cols-subgrid items-center py-1.5",
        divided && "border-b border-foreground/5"
      )}
    >
      {/* Inline, so a label too long for its column wraps, and the info
          icon stays on the line of the label's last word. A span, not a
          <label>: one holding the icon's button would click it. */}
      <div className="min-w-0 text-sm leading-4">
        {description ? (
          <Label asChild className="inline text-sm leading-4">
            <span>
              {labelHead(label)}
              <span className="whitespace-nowrap">
                {labelLastWord(label)}
                <KnobDescription label={label} description={description} />
              </span>
            </span>
          </Label>
        ) : (
          <Label className="inline text-sm leading-4">{label}</Label>
        )}
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2.5">
        <KnobControl def={def} value={value} onChange={onChange} />
      </div>
    </div>
  )
}

/** A label up to and including the space before its last word. */
export function labelHead(label: string): string {
  return label.replace(/\S+\s*$/, "")
}

/** A label's last word, which its info icon never wraps away from. */
export function labelLastWord(label: string): string {
  return label.slice(labelHead(label).length).trimEnd()
}

/**
 * A described knob's info icon. The description shows in a tooltip on hover
 * or keyboard focus, and a click or tap toggles it, so it's reachable without
 * a mouse.
 */
function KnobDescription({
  label,
  description,
}: {
  label: string
  description: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <TooltipProvider>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`About ${label}`}
            className="ml-1 inline-flex size-4 items-center justify-center rounded-sm align-[-3px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={(e) => {
              // Radix closes a tooltip on a trigger click; toggle instead.
              e.preventDefault()
              setOpen((was) => !was)
            }}
          >
            <InfoIcon className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

interface KnobControlProps {
  def: KnobDef
  value: KnobValue
  onChange: (next: KnobValue) => void
}

/** A knob's control, filling the right-hand column. */
function KnobControl({ def, value, onChange }: KnobControlProps) {
  switch (def.type) {
    case "slider": {
      const numericValue = typeof value === "number" ? value : def.default
      return (
        <>
          <Slider
            min={def.min}
            max={def.max}
            step={def.step ?? 1}
            value={[numericValue]}
            onValueChange={(vals) => {
              const next = vals[0]
              if (typeof next === "number") onChange(next)
            }}
            className="flex-1 **:data-[slot=slider-thumb]:size-3.5 **:data-[slot=slider-track]:data-[orientation=horizontal]:h-1"
          />
          {/* Sized for the widest value the slider reaches, so dragging
              never moves the track. */}
          <span
            className="shrink-0 text-right text-xs text-muted-foreground tabular-nums"
            style={{ width: `${sliderValueChars(def)}ch` }}
          >
            {numericValue}
          </span>
        </>
      )
    }
    case "number": {
      const numericValue = typeof value === "number" ? value : def.default
      return (
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
          className="h-7 text-sm md:text-sm"
        />
      )
    }
    case "boolean": {
      const boolValue = typeof value === "boolean" ? value : def.default
      return <Switch checked={boolValue} onCheckedChange={onChange} />
    }
    case "string": {
      const stringValue = typeof value === "string" ? value : def.default
      return (
        <Input
          type="text"
          value={stringValue}
          placeholder={def.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 text-sm md:text-sm"
        />
      )
    }
    case "tabs": {
      const stringValue = typeof value === "string" ? value : def.default
      // In the 136px column more than a few won't fit: those show as a
      // select rather than wrap or truncate.
      if (def.options.length > TABS_KNOB_MAX_OPTIONS)
        return (
          <KnobControl
            def={{ ...def, type: "select" }}
            value={value}
            onChange={onChange}
          />
        )
      return (
        <Tabs value={stringValue} onValueChange={onChange} className="flex-1">
          <TabsList className="w-full group-data-horizontal/tabs:h-7">
            {def.options.map((opt) => (
              <TabsTrigger
                key={opt.value}
                value={opt.value}
                className="flex-1 justify-center text-sm"
              >
                {opt.label ?? opt.value}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )
    }
    case "select": {
      const stringValue = typeof value === "string" ? value : def.default
      return (
        <Select value={stringValue} onValueChange={onChange}>
          <SelectTrigger
            size="sm"
            className="w-full text-sm data-[size=sm]:h-7"
          >
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
      )
    }
    case "color": {
      const stringValue = typeof value === "string" ? value : def.default
      // A field like the text knobs': a swatch and the hex value, with the
      // native colour input stretched invisibly over it to open the picker.
      return (
        <label className="relative flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-input bg-transparent px-1.5 text-sm transition-colors has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50 dark:bg-input/30">
          <span
            aria-hidden
            className="size-4 shrink-0 rounded-sm ring-1 ring-foreground/10 ring-inset"
            style={{ backgroundColor: stringValue }}
          />
          <span className="truncate text-foreground uppercase tabular-nums">
            {stringValue.replace(/^#/, "")}
          </span>
          <input
            type="color"
            value={stringValue}
            onChange={(e) => onChange(e.target.value)}
            aria-label={def.label ?? def.id}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
      )
    }
  }
}

/** Characters the slider's widest value needs, with its step's decimals. */
function sliderValueChars(def: Extract<KnobDef, { type: "slider" }>): number {
  const decimals = def.step ? (String(def.step).split(".")[1]?.length ?? 0) : 0
  return Math.max(
    def.min.toFixed(decimals).length,
    def.max.toFixed(decimals).length
  )
}
