import { Monitor, Smartphone, Tablet, type LucideIcon } from "lucide-react"

export type IframeLayerSizeCategory = "Desktop" | "Tablet" | "Mobile"

export type IframeLayerSizePreset = {
  id: string
  label: string
  width: number
  height: number
  category: IframeLayerSizeCategory
  /** Display corner radius in CSS px, matching the device's screen.
   *  iPhone values come from Apple's private `_displayCornerRadius` (via the
   *  ScreenCorners library). iPad / Android values are the published or
   *  best-known design specs. Omit (or 0) for square-cornered displays. */
  cornerRadius?: number
}

export const IFRAME_LAYER_SIZE_PRESETS: IframeLayerSizePreset[] = [
  // Desktop
  { id: "desktop-4k", label: "Desktop · 4K", width: 3840, height: 2160, category: "Desktop" },
  { id: "desktop-fullhd", label: "Desktop · 1920 × 1080", width: 1920, height: 1080, category: "Desktop" },
  { id: "macbook-pro-16", label: "MacBook Pro 16″", width: 1728, height: 1117, category: "Desktop" },
  { id: "macbook-pro-14", label: "MacBook Pro 14″", width: 1512, height: 982, category: "Desktop" },
  { id: "desktop-laptop", label: "Laptop · 1440 × 900", width: 1440, height: 900, category: "Desktop" },
  { id: "desktop-default", label: "Laptop · 1280 × 800", width: 1280, height: 800, category: "Desktop" },

  // Tablet
  { id: "ipad-pro-13", label: "iPad Pro 13″ (M4)", width: 1024, height: 1366, category: "Tablet", cornerRadius: 30 },
  { id: "ipad-pro-11", label: "iPad Pro 11″ (M4)", width: 834, height: 1194, category: "Tablet", cornerRadius: 30 },
  { id: "ipad-air-13", label: "iPad Air 13″ (M3)", width: 1024, height: 1366, category: "Tablet", cornerRadius: 18 },
  { id: "ipad-air-11", label: "iPad Air 11″ (M3)", width: 820, height: 1180, category: "Tablet", cornerRadius: 18 },
  { id: "ipad-mini", label: "iPad mini (A17 Pro)", width: 744, height: 1133, category: "Tablet", cornerRadius: 21 },
  { id: "galaxy-tab-s10", label: "Galaxy Tab S10 Ultra", width: 960, height: 1500, category: "Tablet", cornerRadius: 14 },

  // Mobile
  { id: "iphone-17-pro-max", label: "iPhone 17 Pro Max", width: 440, height: 956, category: "Mobile", cornerRadius: 62 },
  { id: "iphone-17-pro", label: "iPhone 17 Pro", width: 402, height: 874, category: "Mobile", cornerRadius: 62 },
  { id: "iphone-17", label: "iPhone 17", width: 402, height: 874, category: "Mobile", cornerRadius: 62 },
  { id: "iphone-air", label: "iPhone Air", width: 402, height: 874, category: "Mobile", cornerRadius: 62 },
  { id: "iphone-se", label: "iPhone SE", width: 375, height: 667, category: "Mobile" },
  { id: "pixel-9-pro-xl", label: "Pixel 9 Pro XL", width: 432, height: 960, category: "Mobile", cornerRadius: 36 },
  { id: "pixel-9-pro", label: "Pixel 9 Pro", width: 412, height: 915, category: "Mobile", cornerRadius: 36 },
  { id: "galaxy-s25-ultra", label: "Galaxy S25 Ultra", width: 384, height: 832, category: "Mobile", cornerRadius: 18 },
  { id: "galaxy-s25", label: "Galaxy S25", width: 360, height: 780, category: "Mobile", cornerRadius: 28 },
  { id: "galaxy-z-fold", label: "Galaxy Z Fold (unfolded)", width: 884, height: 1104, category: "Mobile", cornerRadius: 12 },
]

export const DEFAULT_IFRAME_LAYER_SIZE_ID = "desktop-default"

export const IFRAME_LAYER_SIZE_CATEGORY_ICONS: Record<IframeLayerSizeCategory, LucideIcon> = {
  Desktop: Monitor,
  Tablet: Tablet,
  Mobile: Smartphone,
}

const CATEGORY_ORDER: IframeLayerSizeCategory[] = ["Desktop", "Tablet", "Mobile"]

export const GROUPED_IFRAME_LAYER_SIZE_PRESETS: Array<{
  category: IframeLayerSizeCategory
  presets: IframeLayerSizePreset[]
}> = CATEGORY_ORDER.map((category) => ({
  category,
  presets: IFRAME_LAYER_SIZE_PRESETS.filter((p) => p.category === category),
}))

/** Look up a preset by id, falling back to the default preset if missing. */
export function getIframeLayerSizePreset(id: string | undefined): IframeLayerSizePreset {
  const fallback = IFRAME_LAYER_SIZE_PRESETS.find((p) => p.id === DEFAULT_IFRAME_LAYER_SIZE_ID)!
  if (!id) return fallback
  return IFRAME_LAYER_SIZE_PRESETS.find((p) => p.id === id) ?? fallback
}
