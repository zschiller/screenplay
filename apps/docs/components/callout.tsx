import type { ComponentProps } from "react"
import { Callout as NextraCallout } from "nextra/components"
import { InfoIcon, WarningIcon } from "@workspace/ui/components/icons"

const icons = {
  info: <InfoIcon className="sp-callout-icon sp-callout-info" aria-hidden />,
  warning: (
    <WarningIcon className="sp-callout-icon sp-callout-warning" aria-hidden />
  ),
}

/**
 * Nextra's Callout with the app's Phosphor icons. CSS in `app/globals.css`
 * restyles it as the app's outline Alert: hairline border, regular text, and
 * only the icon coloured. Other types keep Nextra's own icon.
 */
export function Callout({
  type = "default",
  emoji,
  ...props
}: ComponentProps<typeof NextraCallout>) {
  const icon =
    type && type in icons ? icons[type as keyof typeof icons] : undefined
  return <NextraCallout type={type} emoji={emoji ?? icon} {...props} />
}
