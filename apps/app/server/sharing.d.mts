import type { ExposedPort, PreviewExposure } from "@/lib/preview-exposure/types"

export interface ViewerListener {
  name: string
  address: string
  port: number
}

export interface SharingState {
  on: boolean
  /** Where viewers load the app, origin only, while Sharing is on. */
  origin: string | null
  /** Why Sharing last failed to turn on, for the owner. */
  error: string | null
}

export interface Sharing {
  start(): Promise<SharingState>
  state(): SharingState
  set(on: boolean): Promise<SharingState>
  expose(port: number): Promise<ExposedPort>
  release(port: number): Promise<void>
}

export declare function createSharing(opts: {
  open: (listener: ViewerListener) => Promise<{ close: () => Promise<void> }>
  exposure: () => PreviewExposure | undefined
  closeViewerSockets?: () => Promise<void>
  file?: string
  freePort?: () => Promise<number>
  log?: (line: string) => void
}): Sharing

export declare function setSharing(sharing: Sharing | undefined): void
export declare function getSharing(): Sharing | undefined
export declare function setSharingExposure(
  exposure: PreviewExposure | undefined
): void
export declare function sharingExposure(): PreviewExposure | undefined
export declare function pickFreePort(): Promise<number>
