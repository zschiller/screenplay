import { readFile } from "node:fs/promises"
import { join } from "node:path"

export const size = {
  width: 32,
  height: 32,
}

export const contentType = "image/svg+xml"

export default async function Icon() {
  const filename =
    process.env.NODE_ENV === "development" ? "icon-dev.svg" : "icon-prod.svg"
  const icon = await readFile(join(process.cwd(), "app", filename), "utf8")

  return new Response(icon, {
    headers: {
      "Content-Type": contentType,
    },
  })
}
