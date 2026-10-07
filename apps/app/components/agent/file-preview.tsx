"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@workspace/ui/lib/utils"
import { ChatMarkdown } from "@/components/agent/chat-markdown"
import { useMockupRefs } from "@/hooks/use-mockup-refs"
import { useMockupRuntime } from "@/hooks/use-mockup-runtime"
import { readDocumentBody } from "@/lib/document-markdown"
import { useYjs } from "@/lib/yjs/context"
import { documentFragment } from "@/lib/yjs/fragment-text"
import { mockupSrcDoc } from "@/lib/yjs/mockup-html"
import { useMockupHtml } from "@/lib/yjs/react"

/**
 * Previews of a Document or Mockup file (#1885): what a tile in a chat reply
 * shows above its name. Both fill the box they're put in.
 */

/** The width a Mockup's page lays out at in a preview: a narrow window. */
const PREVIEW_LAYOUT_WIDTH = 640

/**
 * A Mockup's page as its views show it (`mockupSrcDoc`, with the runtime and
 * its resolved references), kept current; undefined while it loads or when
 * the page is empty.
 */
export function useMockupSrcDoc(fileId: string): string | undefined {
  const html = useMockupHtml(fileId)
  const runtime = useMockupRuntime()
  const resources = useMockupRefs(fileId, html)
  return useMemo(
    () =>
      html.trim() && runtime !== null && resources !== null
        ? mockupSrcDoc(html, runtime, resources)
        : undefined,
    [html, runtime, resources]
  )
}

/** A Document's body as markdown below its title, kept current. */
export function useDocumentBody(fileId: string): string {
  const { doc } = useYjs()
  const fragment = useMemo(() => documentFragment(doc, fileId), [doc, fileId])
  const [body, setBody] = useState("")
  useEffect(() => {
    const read = () => setBody(readDocumentBody(fragment).trim())
    read()
    fragment.observeDeep(read)
    return () => fragment.unobserveDeep(read)
  }, [fragment])
  return body
}

/** The box's size, following its resizes; zero until measured. */
function useBoxSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () =>
      setSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}

/**
 * A Mockup's page, live, scaled down to the box's width from a narrow
 * window's, its top showing. Inert: it takes no pointer or focus.
 */
export function MockupPreview({
  fileId,
  title,
  className,
}: {
  fileId: string
  title: string
  className?: string
}) {
  const srcDoc = useMockupSrcDoc(fileId)
  const boxRef = useRef<HTMLDivElement>(null)
  const { width, height } = useBoxSize(boxRef)
  const scale = width / PREVIEW_LAYOUT_WIDTH
  return (
    <div
      ref={boxRef}
      data-slot="file-preview"
      className={cn("relative overflow-hidden bg-white", className)}
    >
      {srcDoc !== undefined && width > 0 && (
        <iframe
          title={title}
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
          style={{
            width: PREVIEW_LAYOUT_WIDTH,
            height: height / scale,
            transform: `scale(${scale})`,
          }}
        />
      )}
    </div>
  )
}

/** A Document's title and opening lines, as it reads, cut off at the box. */
export function DocumentPreview({
  fileId,
  title,
  className,
}: {
  fileId: string
  title: string
  className?: string
}) {
  const body = useDocumentBody(fileId)
  return (
    <div
      data-slot="file-preview"
      className={cn(
        "overflow-hidden bg-background px-3 py-2.5 text-xs [&_.chat-markdown>:first-child]:mt-0",
        className
      )}
    >
      {title && <p className="font-medium">{title}</p>}
      {body && (
        <ChatMarkdown
          size="xs"
          className="mt-0.5 [&_h1,&_h2,&_h3,&_h4]:mt-2 [&_h1,&_h2,&_h3,&_h4]:mb-0.5 [&_h1,&_h2,&_h3,&_h4]:text-xs [&_h1,&_h2,&_h3,&_h4]:font-medium"
        >
          {body.slice(0, 600)}
        </ChatMarkdown>
      )}
    </div>
  )
}
