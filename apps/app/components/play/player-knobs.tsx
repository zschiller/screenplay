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
        <div className="flex flex-col gap-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">No knobs declared</p>
          <p>
            Call{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-2xs text-foreground">
              useKnob()
            </code>{" "}
            from{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-2xs text-foreground">
              @screenplay.space/knobs
            </code>{" "}
            inside this prototype to expose live controls here.
          </p>
        </div>
      }
    />
  )
}
