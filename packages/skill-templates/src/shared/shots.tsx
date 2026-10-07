import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@workspace/ui/lib/utils"

import { ThemeContext } from "./theme.tsx"

/** A capture: `p` the light (or only) image, `dk` an optional dark one; `bare` keeps `cap` as alt text only. */
export type Img = { p: string; cap: string; dk?: string; bare?: boolean }

/**
 * Where a capture loads from: its path, relative to the page, which on a
 * canvas is the Mockup's folder (#1889). A page made before folders lists its
 * captures as `<img alt="<path>" src="files:<path>">` inside `#files`, which
 * the canvas swaps for loadable URLs.
 */
let files: Map<string, string> | undefined
export function captureSrc(path: string) {
  files ??= new Map(
    [...document.querySelectorAll<HTMLImageElement>("#files img[alt]")].map(
      (img) => [img.alt, img.src]
    )
  )
  return files.get(path) ?? path
}

const LightboxContext = React.createContext<(src: string) => void>(() => {})

/** Tap a capture to see it at full size; tap anywhere to close. */
export function Lightbox({ children }: { children: React.ReactNode }) {
  const [src, setSrc] = React.useState<string | null>(null)
  return (
    <LightboxContext.Provider value={setSrc}>
      {children}
      <DialogPrimitive.Root
        open={src != null}
        onOpenChange={(open) => !open && setSrc(null)}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/85" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            onClick={() => setSrc(null)}
            className="fixed inset-0 z-50 grid cursor-zoom-out place-items-center overflow-auto p-4 outline-none"
          >
            <DialogPrimitive.Title className="sr-only">
              Capture
            </DialogPrimitive.Title>
            {src && (
              <img
                src={src}
                alt=""
                className="max-w-none bg-muted md:max-w-full"
              />
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </LightboxContext.Provider>
  )
}

/**
 * Captures are taken at 2x: one never shows wider than its own pixels allow,
 * so a small crop stays sharp instead of blowing up to the column.
 */
const atSize = (e: React.SyntheticEvent<HTMLImageElement>) => {
  const img = e.currentTarget
  img.style.maxWidth = img.naturalWidth / 2 + "px"
}

/**
 * Captures in the viewer's theme only. Images load eagerly: a lazy image in a
 * hidden tab has no height, so switching tabs would land partway down.
 */
export function Shots({
  list,
  className,
  style,
}: {
  list?: Img[]
  className?: string
  style?: React.CSSProperties
}) {
  const open = React.useContext(LightboxContext)
  const dark = React.useContext(ThemeContext)
  if (!list?.length) return null
  return (
    <div className={cn("flex flex-col gap-3", className)} style={style}>
      {list.map((i, n) => (
        <figure key={n} className="m-0 flex min-w-0 flex-col gap-1">
          <button
            type="button"
            aria-label={`Enlarge ${i.cap}`}
            onClick={() => open(captureSrc(dark && i.dk ? i.dk : i.p))}
            className="block w-fit max-w-full cursor-zoom-in border bg-muted p-0 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <img
              src={captureSrc(i.p)}
              alt={i.cap}
              onLoad={atSize}
              className={cn("block h-auto w-full", i.dk && "dark:hidden")}
            />
            {i.dk && (
              <img
                src={captureSrc(i.dk)}
                alt=""
                aria-hidden
                onLoad={atSize}
                className="hidden h-auto w-full dark:block"
              />
            )}
          </button>
          {!i.bare && (
            <figcaption className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
              {i.cap}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  )
}
