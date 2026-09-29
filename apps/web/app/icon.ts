import { DEV_MARK_FILLS, markSvg } from "@workspace/ui/lib/brand"

export const size = {
  width: 32,
  height: 32,
}

export const contentType = "image/svg+xml"

export default function Icon() {
  const icon = markSvg(
    process.env.NODE_ENV === "development" ? DEV_MARK_FILLS : undefined
  )

  return new Response(icon, {
    headers: {
      "Content-Type": contentType,
    },
  })
}
