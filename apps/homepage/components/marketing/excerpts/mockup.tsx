import { CircleIcon } from "@workspace/ui/components/icons"

import { Frame, FrameBar, versions } from "./canvas"
import { Fit } from "./fit"
import { Northwind } from "./northwind"

/*
 * Before you build's figure: a Workspace's live page, selected with its bar,
 * and a take its chat drew beside it as a Mockup. The Mockup joins the
 * Workspace's group, so the group's title names the Workspace once, and the
 * Mockup's label ends with its status, as the app's MockupStatusMenu draws it.
 */

/**
 * A Mockup's status at the end of its label: its icon and name in muted
 * text (the up-down caret shows only on hover).
 */
function Status({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex shrink-0 items-center text-xs text-muted-foreground">
      <CircleIcon aria-hidden className="mr-1 size-3 shrink-0" />
      {children}
    </span>
  )
}

const [, live, take] = versions

/**
 * Laid out at a fixed size and scaled to the column like an image, as the
 * For teams figure is, so the labels and bar keep the app's proportions.
 */
export function MockupExcerpt() {
  return (
    <Fit
      width={640}
      height={360}
      initialScale={0.9}
      role="img"
      aria-label={`The ${live.title} Workspace's live page, selected with its bar, beside a Mockup its chat drew of a dark hero, labelled Current.`}
      className="border border-border"
    >
      <div className="bg-plane relative size-full overflow-hidden text-foreground">
        <Frame
          label="Home"
          group={["Hero", live.title]}
          selected
          style={{ left: 24, top: 100, width: 288 }}
        >
          <Northwind version={live.version} />
        </Frame>
        <FrameBar className="z-[5]" style={{ left: 8, top: 290, width: 360 }} />
        <Frame
          label={`Take A · ${take.title}`}
          trailing={<Status>Current</Status>}
          style={{ left: 336, top: 100, width: 288 }}
        >
          <Northwind version={take.version} />
        </Frame>
      </div>
    </Fit>
  )
}
