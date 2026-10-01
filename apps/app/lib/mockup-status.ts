import type { MockupLayerData, MockupStatus } from "@/lib/types"

/** How each Mockup status reads in its label menu and to a chat (#1310). */
export const MOCKUP_STATUS_LABELS: Readonly<Record<MockupStatus, string>> = {
  "set-aside": "Set aside",
  current: "Current",
  built: "Built",
}

/** A Mockup's status; one made before statuses existed reads as Current. */
export function mockupStatusOf(mockup: Pick<MockupLayerData, "status">) {
  return mockup.status ?? "current"
}
