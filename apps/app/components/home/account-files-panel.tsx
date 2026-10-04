"use client"

import { useCallback, useEffect, useState } from "react"
import { SidebarProvider } from "@workspace/ui/components/sidebar"
import {
  accountFileUrl,
  deleteAccountFile,
  FilesSection,
  type FilesCopy,
} from "@/components/canvas/canvas-files-section"
import { LoadErrorRow } from "@/components/home/load-error"
import { SettingsRowSkeleton } from "@/components/home/settings-row"
import { listAccountFiles } from "@/lib/files/account-actions"
import { openAccountFileOnDesktop } from "@/lib/files/desktop-actions"
import { isLocalBuild } from "@/lib/local-mode"
import type { FileEntryData } from "@/lib/types"

const COPY: FilesCopy = {
  // The section's header says what these are.
  intro: null,
  emptyDescription:
    "Ask a chat to save a file to your account, and every chat you message can open it.",
  readers: "your chats",
}

const adderName = (entry: FileEntryData) =>
  entry.addedBy === "agent" ? "Saved by agent" : "Added by you"

/**
 * Settings › Files (#1521): your Account Files, with the same read-only tree
 * as Canvas settings › Files. Open shows a file in a dialog over Settings (on
 * the desktop, in its own Mac app, with Reveal in Finder); Delete confirms.
 */
export function AccountFilesPanel({
  header,
  list = listAccountFiles,
  deleteFile = deleteAccountFile,
  openFileOnDesktop = isLocalBuild ? openAccountFileOnDesktop : undefined,
}: {
  header: (action?: React.ReactNode) => React.ReactNode
  list?: () => Promise<FileEntryData[]>
  deleteFile?: (path: string) => Promise<void>
  openFileOnDesktop?: (path: string, how: "open" | "reveal") => Promise<void>
}) {
  const [files, setFiles] = useState<FileEntryData[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    list()
      .then((entries) => {
        if (!cancelled) setFiles(entries)
      })
      .catch((err) => {
        console.error("Failed to load files", err)
        if (!cancelled) setLoadFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [list])

  // Retry after a failed load; a second failure rejects and leaves the error up.
  const reload = useCallback(async () => {
    setFiles(await list())
    setLoadFailed(false)
  }, [list])

  return (
    <>
      {header()}
      {loading ? (
        <SettingsRowSkeleton label="Loading files…" count={2} />
      ) : loadFailed ? (
        <LoadErrorRow title="Couldn’t load files" onRetry={reload} />
      ) : (
        // The tree is built from sidebar rows, which read a sidebar's state.
        <SidebarProvider className="block min-h-0">
          <FilesSection
            fileUrl={accountFileUrl}
            files={files}
            copy={COPY}
            adderName={adderName}
            onDelete={async (path) => {
              await deleteFile(path)
              setFiles((prev) =>
                prev.filter(
                  (f) => f.path !== path && !f.path.startsWith(`${path}/`)
                )
              )
            }}
            onDesktop={openFileOnDesktop}
          />
        </SidebarProvider>
      )}
    </>
  )
}
