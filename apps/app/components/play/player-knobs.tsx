"use client"

import type { KnobValues } from "@/lib/knobs/types"
import type { JsonObject, JsonValue } from "@/lib/postmessage-protocol"
import { KnobsPanel } from "@/components/knobs-panel"

interface PlayerKnobsProps {
  knobs: JsonValue[]
  values: JsonObject
  onChange: (next: KnobValues) => void
}

export function PlayerKnobs({ knobs, values, onChange }: PlayerKnobsProps) {
  return (
    <KnobsPanel
      knobs={knobs}
      values={values}
      onChange={onChange}
      empty={
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No knobs yet</p>
          <p>
            Knobs let you adjust this page live, like a slider for card padding.
            Ask the agent to add one.
          </p>
        </div>
      }
    />
  )
}
