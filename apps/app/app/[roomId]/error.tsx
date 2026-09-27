"use client"

import { startTransition, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { RotateCw, TriangleAlert } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import { CanvasRouteState } from "@/components/canvas/canvas-route-state"

/**
 * The Canvas route's error boundary: the server render (or the Canvas itself)
 * threw. Retry re-runs the server render and resets the boundary together — a
 * bare `reset()` would re-render the same failed server payload.
 */
export default function CanvasError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <CanvasRouteState
      icon={<TriangleAlert />}
      title="Couldn't open this canvas"
      description="Something went wrong while loading it. Try again, or head back to your files."
      footer={
        error.digest ? (
          <p className="font-mono text-xs text-muted-foreground/70 select-text">
            Error {error.digest}
          </p>
        ) : null
      }
    >
      <Button
        size="sm"
        onClick={() =>
          startTransition(() => {
            router.refresh()
            reset()
          })
        }
      >
        <RotateCw />
        Retry
      </Button>
      <Button size="sm" variant="outline" asChild>
        <Link href="/files">Go to All files</Link>
      </Button>
    </CanvasRouteState>
  )
}
