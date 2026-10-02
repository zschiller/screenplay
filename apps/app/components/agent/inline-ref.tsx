"use client"

import type { ComponentProps, ReactNode } from "react"
import {
  CrosshairIcon,
  FileTextIcon,
  FrameCornersIcon,
  ScribbleIcon,
} from "@workspace/ui/components/icons"
import { cn } from "@workspace/ui/lib/utils"

/**
 * How a chat message names something: a Workspace, a document, a frame, a
 * mockup, a targeted element or a skill. Its icon (a Workspace's is its state
 * glyph) and its name in medium weight, in the text colour, never underlined.
 * The look lives in the `.inline-ref` rules in `app/globals.css`, which the
 * composer's and the document editor's mention nodes share.
 */
export type InlineRefKind =
  "workspace" | "document" | "frame" | "mockup" | "element" | "skill"

/** The toolbar's icon for each kind of layer, and the element crosshair. */
const ICONS: Partial<Record<InlineRefKind, typeof FileTextIcon>> = {
  document: FileTextIcon,
  frame: FrameCornersIcon,
  mockup: ScribbleIcon,
  element: CrosshairIcon,
}

export function InlineRef({
  kind,
  icon,
  onClick,
  className,
  children,
  ...props
}: Omit<ComponentProps<"span">, "onClick"> & {
  kind: InlineRefKind
  /** Replaces the kind's icon: a Workspace passes its state glyph. */
  icon?: ReactNode
  /** Makes the reference a button (open the Workspace, show the layer). */
  onClick?: () => void
}) {
  const Icon = ICONS[kind]
  const content = (
    <>
      {icon ? (
        <span className="inline-ref-icon">{icon}</span>
      ) : (
        Icon && <Icon aria-hidden className="inline-ref-icon" />
      )}
      <span className="inline-ref-label">{children}</span>
    </>
  )
  if (onClick) {
    return (
      <button
        type="button"
        data-inline-ref={kind}
        className={cn("inline-ref", className)}
        onClick={onClick}
        {...(props as Omit<ComponentProps<"button">, "onClick">)}
      >
        {content}
      </button>
    )
  }
  return (
    <span
      data-inline-ref={kind}
      className={cn("inline-ref", className)}
      {...props}
    >
      {content}
    </span>
  )
}
