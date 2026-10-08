import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { RefusedScreen } from "@/components/viewer/refused-screen"
import { requestRole } from "@/lib/viewer-identity/request"

export const metadata: Metadata = { title: { absolute: "Screenplay" } }

/**
 * The page a viewer listener serves a viewer its identity refused (#1931),
 * whatever they asked for; the front server rewrites the request here with
 * the refusal attached. Anyone else, the host included, finds nothing.
 */
export default async function ViewerRefusedPage() {
  const role = await requestRole()
  if (role.role !== "refused") notFound()
  return <RefusedScreen message={role.message} />
}
