import type { PanelLayout } from "@/lib/panel-layout"

export function CanvasSkeleton({
  initialLayout,
}: {
  initialLayout?: PanelLayout
}) {
  const sidebarGrow = initialLayout?.sidebar
  const canvasGrow = initialLayout?.canvas
  const chatGrow = initialLayout?.chat
  const haveLayout =
    typeof sidebarGrow === "number" &&
    typeof canvasGrow === "number" &&
    typeof chatGrow === "number"

  const showSidebar = haveLayout ? sidebarGrow > 0 : true
  const showChat = haveLayout ? chatGrow > 0 : false

  const sidebarStyle: React.CSSProperties = haveLayout
    ? { flexGrow: sidebarGrow, flexShrink: 0, flexBasis: 0 }
    : { width: 240, flexShrink: 0 }
  const canvasStyle: React.CSSProperties = haveLayout
    ? { flexGrow: canvasGrow, flexShrink: 1, flexBasis: 0 }
    : { flexGrow: 1, flexShrink: 1, flexBasis: 0 }
  const chatStyle: React.CSSProperties | undefined = haveLayout
    ? { flexGrow: chatGrow, flexShrink: 0, flexBasis: 0 }
    : undefined

  return (
    <div className="fixed inset-0 flex bg-muted/30">
      {showSidebar && (
        <>
          <aside style={sidebarStyle} className="h-full min-w-0 bg-sidebar" />
          <div className="w-px bg-border" />
        </>
      )}
      <div style={canvasStyle} className="min-w-0" />
      {showChat && (
        <>
          <div className="w-px bg-border" />
          <aside style={chatStyle} className="h-full min-w-0 bg-background" />
        </>
      )}
    </div>
  )
}
