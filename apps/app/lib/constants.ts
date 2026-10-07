export const ZOOM_MIN = 0.02
export const ZOOM_MAX = 16
/**
 * Highest zoom that Zoom to fit / to selection lands on, so fitting a small
 * layer doesn't jump all the way to `ZOOM_MAX`.
 */
export const FIT_ZOOM_MAX = 5
export const ZOOM_STEP = 0.015

export const DEFAULT_IFRAME_LAYER_WIDTH = 1280
export const DEFAULT_IFRAME_LAYER_HEIGHT = 800

/** A new Document's size, as a click with the Document tool makes it. */
export const DEFAULT_DOCUMENT_WIDTH = 480
export const DEFAULT_DOCUMENT_HEIGHT = 640

export const MIN_IFRAME_LAYER_WIDTH = 100
export const MIN_IFRAME_LAYER_HEIGHT = 100

/** Smallest box a Mockup Layer (#1267) resizes to. */
export const MOCKUP_MIN_WIDTH = 100
export const MOCKUP_MIN_HEIGHT = 100

/**
 * Tallest a frame or Mockup grows to while Fit to content follows its page,
 * so a page whose content keeps outgrowing its viewport stops somewhere.
 */
export const FIT_CONTENT_MAX_HEIGHT = 16000

/** Horizontal flex gap between iframe layers in a group. */
export const IFRAME_LAYER_GROUP_GAP = 50

export const CANVAS_SIZE = 10000
