"use client"

import { useMemo, useState } from "react"
import { SlidersHorizontalIcon } from "@workspace/ui/components/icons"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { FloatingToolbarButton } from "@workspace/ui/components/floating-toolbar"
import type { KnobValues } from "@/lib/knobs/types"
import type { JsonObject, JsonValue } from "@/lib/postmessage-protocol"
import {
  hasKnobOverrides,
  knobDefs,
  KnobsPanel,
  type KnobsTheme,
} from "@/components/knobs-panel"

interface KnobsPopoverProps {
  knobs: JsonValue[] | undefined
  values: JsonObject | undefined
  onChange: (values: KnobValues) => void
  /**
   * Start an "add a knob" request in the frame's Workspace chat. Shown as the
   * empty state's action; absent for a frame with no Workspace.
   */
  onAskForKnob?: () => void
  /** A shared frame's Theme knob (see `KnobsPanel`). */
  theme?: { value: KnobsTheme; onChange: (next: KnobsTheme) => void }
}

export function KnobsPopover({
  knobs,
  values,
  onChange,
  onAskForKnob,
  theme,
}: KnobsPopoverProps) {
  const [open, setOpen] = useState(false)
  const themed = !!theme && theme.value !== "light"
  const hasOverrides = useMemo(
    () => themed || hasKnobOverrides(knobDefs(knobs), values),
    [themed, knobs, values]
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FloatingToolbarButton label="Knobs" className="relative">
          <SlidersHorizontalIcon />
          {hasOverrides ? (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-info-fill ring-1 ring-background"
            />
          ) : null}
        </FloatingToolbarButton>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        collisionPadding={16}
        className="w-80 gap-0 overflow-hidden p-0"
      >
        <KnobsPanel
          knobs={knobs}
          values={values}
          onChange={onChange}
          theme={theme}
          empty={
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                {theme ? "No knobs from this page yet" : "No knobs yet"}
              </p>
              <p>
                Knobs let you adjust this page live, like a slider for card
                padding.
              </p>
              {onAskForKnob ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1 self-start"
                  onClick={() => {
                    setOpen(false)
                    onAskForKnob()
                  }}
                >
                  Ask the agent to add a knob
                </Button>
              ) : null}
            </div>
          }
        />
      </PopoverContent>
    </Popover>
  )
}
