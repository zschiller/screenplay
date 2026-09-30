"use client"

import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import { nanoid } from "nanoid"
import { toast } from "sonner"
import { FolderOpenIcon, GlobeIcon } from "@workspace/ui/components/icons"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { RepoPicker, type RepoPickerSelection } from "@/components/repo-picker"
import { RepoAddSettings } from "@/components/repo-add-settings"
import { chooseLocalFolder, LocalFolderForm } from "@/components/local-folder"
import {
  detectFolderSettings,
  detectRepoSettings,
  refineFolderSettings,
  refineRepoSettings,
} from "@/lib/add-repo/actions"
import {
  resolvePresetUpsert,
  type ResolvedRepoSettings,
} from "@/lib/add-repo/resolver"
import { isLocalBuild } from "@/lib/local-mode"
import type { RepoConfig } from "@/lib/repo-configs.types"
import { listRepoConfigs, upsertRepoConfig } from "@/lib/repo-configs-actions"

/** A human-readable label for a picker pick, for the settings-stage header. */
function pickLabel(pick: RepoPickerSelection): string {
  if (pick.kind === "repo") return pick.repo.fullName
  if (pick.kind === "config")
    return pick.config.name
      ? `${pick.config.repoFullName} · ${pick.config.name}`
      : pick.config.repoFullName
  return pick.source.repoFullName || pick.source.localPath || "this repository"
}

/**
 * The add-repository flow's state (issues #604, #676, #781): which screen of
 * the dialog shows, and the pick waiting in the settings stage. Held by
 * whoever offers Add repository (the sidebar, Canvas settings) and handed to
 * {@link AddRepositoryDialog} and {@link AddRepositoryMenuItems}.
 */
export function useAddRepositoryFlow() {
  // A small view-state machine: the repository/URL picker, the folder-path
  // fallback form (#604), or — once an unconfigured pick is made — the
  // confirm-and-configure `settings` stage (#676), all in one dialog shell.
  const [pickerView, setPickerView] = useState<
    "repos" | "folder" | "settings" | null
  >(null)
  // The unconfigured pick awaiting confirmation in the `settings` stage. Held
  // here so Confirm can create it with the resolved run settings and Cancel can
  // drop it without provisioning anything.
  const [pendingPick, setPendingPick] = useState<RepoPickerSelection | null>(
    null
  )
  // The view the settings stage steps Back to (#781): the list or folder form
  // the pick came from, or `null` when it came straight from the native folder
  // dialog, where Back has nothing to return to and closes.
  const [settingsBackTo, setSettingsBackTo] = useState<
    "repos" | "folder" | null
  >(null)
  // What the folder form opens with: a folder the native dialog picked but
  // couldn't use, and why (#781), or the folder you stepped Back from.
  const [folderInitial, setFolderInitial] = useState<
    { path: string; error?: string } | undefined
  >(undefined)
  const [savedConfigs, setSavedConfigs] = useState<RepoConfig[]>([])

  const closePicker = useCallback(() => {
    setPickerView(null)
    setPendingPick(null)
  }, [])
  // One step back from the current view (Back, Cancel and Escape, #781).
  const stepBack = useCallback(() => {
    if (pickerView === "settings" && settingsBackTo) {
      if (
        settingsBackTo === "folder" &&
        pendingPick?.kind === "source" &&
        pendingPick.source.localPath
      ) {
        setFolderInitial({ path: pendingPick.source.localPath })
      }
      setPendingPick(null)
      setPickerView(settingsBackTo)
    } else {
      closePicker()
    }
  }, [pickerView, settingsBackTo, pendingPick, closePicker])

  // "Open a folder" fires the native OS directory dialog directly; only when no
  // native picker is reachable (sidecar driven from a browser) do we open the
  // dialog on the path-input fallback (#604).
  const openLocalFolder = useCallback(async () => {
    const result = await chooseLocalFolder()
    if (result.kind === "source") {
      // The native folder dialog funnels through the same settings stage as
      // every other unconfigured add (#682): store the pick and flip the dialog
      // so behavior doesn't depend on how the folder was picked.
      setPendingPick({ kind: "source", source: result.source })
      setSettingsBackTo(null)
      setPickerView("settings")
    } else if (result.kind === "error") {
      // Not a usable folder (not a git checkout, say): open the path form on
      // it with the reason, rather than losing both (#781).
      setFolderInitial({ path: result.path, error: result.error })
      setPickerView("folder")
    } else if (result.kind === "fallback") {
      setFolderInitial(undefined)
      setPickerView("folder")
    }
  }, [])
  const openGitHub = useCallback(() => setPickerView("repos"), [])

  useEffect(() => {
    if (pickerView !== "repos") return
    let cancelled = false
    listRepoConfigs().then((list) => {
      if (!cancelled) setSavedConfigs(list)
    })
    return () => {
      cancelled = true
    }
  }, [pickerView])

  return {
    open: pickerView !== null,
    pickerView,
    setPickerView,
    pendingPick,
    setPendingPick,
    settingsBackTo,
    setSettingsBackTo,
    folderInitial,
    savedConfigs,
    setSavedConfigs,
    closePicker,
    stepBack,
    openLocalFolder,
    openGitHub,
  }
}

export type AddRepositoryFlow = ReturnType<typeof useAddRepositoryFlow>

/**
 * The desktop Add repository menu's items: open a folder on this computer, or
 * pick from GitHub. The web build has no folder source, so its Add repository
 * opens the GitHub picker straight away (`flow.openGitHub`), no menu (#604).
 */
export function AddRepositoryMenuItems({
  flow,
  onPick,
}: {
  flow: AddRepositoryFlow
  /** Runs as the picker opens. */
  onPick?: () => void
}) {
  return (
    <>
      <DropdownMenuItem
        onSelect={() => {
          void flow.openLocalFolder()
          onPick?.()
        }}
      >
        <FolderOpenIcon />
        Open folder
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          flow.openGitHub()
          onPick?.()
        }}
      >
        <GlobeIcon />
        Open GitHub repository
      </DropdownMenuItem>
    </>
  )
}

/**
 * The canvas's own add-repository flow (#1182), for every Add repository
 * outside Canvas settings: the empty canvas, the chat panel, the
 * getting-started checklist and the Workspaces menu. The canvas renders its
 * {@link AddRepositoryDialog}; Canvas settings keeps a flow of its own.
 */
const AddRepositoryFlowContext = createContext<AddRepositoryFlow | null>(null)

export const AddRepositoryFlowProvider = AddRepositoryFlowContext.Provider

/**
 * Turns its child button into an Add repository that goes straight to the
 * picker, no Canvas settings in between (#1182): on desktop the Open folder /
 * Open GitHub repository menu, on the web the GitHub picker. `onPick` runs as
 * the picker opens, for a surface that should close then (a popover).
 */
export function AddRepositoryTrigger({
  children,
  align = "start",
  onPick,
}: {
  children: React.ReactElement<{
    onClick?: React.MouseEventHandler<HTMLButtonElement>
  }>
  align?: "start" | "center" | "end"
  onPick?: () => void
}) {
  const flow = useContext(AddRepositoryFlowContext)
  if (!flow) return children
  if (!isLocalBuild) {
    return cloneElement(children, {
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
        children.props.onClick?.(event)
        flow.openGitHub()
        onPick?.()
      },
    })
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        // Both items open a dialog (or the native folder picker); handing
        // focus back to the trigger would pull it out of that dialog.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <AddRepositoryMenuItems flow={flow} onPick={onPick} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The add-repository dialog: the GitHub picker (or the folder form), then the
 * confirm-and-configure settings stage before anything is added.
 */
export function AddRepositoryDialog({
  flow,
  onCreateRepo,
}: {
  flow: AddRepositoryFlow
  onCreateRepo: (
    pick: RepoPickerSelection,
    settings?: ResolvedRepoSettings
  ) => void
}) {
  const {
    pickerView,
    setPickerView,
    pendingPick,
    setPendingPick,
    settingsBackTo,
    setSettingsBackTo,
    folderInitial,
    savedConfigs,
    setSavedConfigs,
    closePicker,
    stepBack,
  } = flow
  return (
    <Dialog
      open={flow.open}
      onOpenChange={(open) => {
        // Dismissing closes it and drops any pick left waiting in the
        // settings stage (adds nothing).
        if (!open) closePicker()
      }}
    >
      <DialogContent
        onEscapeKeyDown={(event) => {
          // Escape steps back one screen, like Back (#781).
          if (pickerView === "settings" && settingsBackTo) {
            event.preventDefault()
            stepBack()
          }
        }}
        className="gap-0 overflow-hidden p-0 sm:max-w-md [&_[data-slot=command-group]:first-child]:pt-0 [&_[data-slot=command-group]:first-child_[cmdk-group-heading]]:pt-0 [&_[data-slot=command-input-wrapper]]:px-5 [&_[data-slot=command-input-wrapper]]:pb-3 [&_[data-slot=command-list]]:px-4 [&_[data-slot=command]]:rounded-none [&_[data-slot=command]]:p-0 [&_[data-slot=repo-picker-footer]]:px-4.5 [&_[data-slot=repo-picker-footer]]:py-2"
      >
        <DialogHeader className="px-5 pt-5 pb-2">
          <DialogTitle>
            {pickerView === "settings"
              ? "Configure repository"
              : pickerView === "folder"
                ? "Open folder"
                : "Open GitHub repository"}
          </DialogTitle>
          {pickerView === "settings" && pendingPick && (
            <DialogDescription>
              {`Confirm the run settings for ${pickLabel(pendingPick)} before it's added.`}
            </DialogDescription>
          )}
        </DialogHeader>
        {pickerView === "settings" && pendingPick ? (
          <RepoAddSettings
            // Detection is backed by the filesystem the pick
            // implies: a GitHub-repo pick reads its virtual FS via
            // the trees API (#678); a local-folder source reads the
            // checkout on disk (#682). A non-GitHub clone-URL source
            // has no files pre-clone and no API, so it opens with
            // plain defaults (no `detect`).
            detect={
              pendingPick.kind === "repo"
                ? () =>
                    detectRepoSettings({
                      owner: pendingPick.repo.owner,
                      repo: pendingPick.repo.name,
                      ref: pendingPick.repo.defaultBranch,
                    })
                : pendingPick.kind === "source" && pendingPick.source.localPath
                  ? () =>
                      detectFolderSettings({
                        localPath: pendingPick.source.localPath!,
                      })
                  : undefined
            }
            // Then a model reads the same files and corrects the
            // rule-based guess.
            refine={
              pendingPick.kind === "repo"
                ? (baseline) =>
                    refineRepoSettings(
                      {
                        owner: pendingPick.repo.owner,
                        repo: pendingPick.repo.name,
                        ref: pendingPick.repo.defaultBranch,
                      },
                      baseline
                    )
                : pendingPick.kind === "source" && pendingPick.source.localPath
                  ? (baseline) =>
                      refineFolderSettings(
                        {
                          localPath: pendingPick.source.localPath!,
                        },
                        baseline
                      )
                  : undefined
            }
            // Env-field presence follows the source (#681): hosted
            // has env vars, a desktop local-folder has files-to-copy,
            // but a desktop GitHub-clone has no injection path — so
            // hide the field there.
            showEnvField={
              !isLocalBuild ||
              (pendingPick.kind === "source" &&
                Boolean(pendingPick.source.localPath))
            }
            onConfirm={(settings, { savePreset }) => {
              onCreateRepo(pendingPick, settings)
              if (savePreset) {
                // Best-effort (#680): remember the resolved settings
                // as this repo's default preset so re-adding it is
                // one click. The resolver upserts by key — a repo
                // already saved updates in place. A failed save
                // never blocks or undoes the add above; at most a
                // toast.
                const now = Date.now()
                const plan = resolvePresetUpsert(
                  pendingPick,
                  settings,
                  savedConfigs,
                  { id: nanoid(), createdAt: now, updatedAt: now },
                  true
                )
                if (plan) {
                  upsertRepoConfig(plan)
                    .then(setSavedConfigs)
                    .catch(() =>
                      toast.error("Couldn't save these settings as a preset.")
                    )
                }
              }
              setPendingPick(null)
              setPickerView(null)
            }}
            // Adds nothing. Steps back to the list or folder the
            // pick came from (#781); closes only when there is
            // nothing to go back to.
            cancelLabel={settingsBackTo ? "Back" : "Cancel"}
            onCancel={stepBack}
          />
        ) : pickerView === "folder" ? (
          <LocalFolderForm
            // On the header's 20px gutter.
            className="px-5 pt-2 pb-5"
            initial={folderInitial}
            onBack={closePicker}
            onResolved={(source) => {
              // The folder-path fallback funnels through the settings
              // stage too (#682), so behavior doesn't depend on how
              // the folder was picked.
              setPendingPick({ kind: "source", source })
              setSettingsBackTo("folder")
              setPickerView("settings")
            }}
          />
        ) : null}
        {/* Stays mounted under the settings stage so Back returns
          to the list with its search and scroll intact (#781). */}
        {(pickerView === "repos" ||
          (pickerView === "settings" && settingsBackTo === "repos")) && (
          <div hidden={pickerView !== "repos"}>
            <RepoPicker
              configs={savedConfigs}
              // The local build can add a Repo with no GitHub auth at
              // all — by clone URL — and offers the on-demand
              // device-flow connect (PRD #428).
              localSources={isLocalBuild}
              onSelect={(pick) => {
                // Every unconfigured pick — a GitHub repo or a pasted
                // clone-URL source — is interposed with the
                // confirm-and-configure settings stage (#676, #682)
                // instead of provisioning on select. Only a
                // saved-preset pick keeps today's one-click add.
                if (pick.kind === "config") {
                  onCreateRepo(pick)
                  setPickerView(null)
                  return
                }
                setPendingPick(pick)
                setSettingsBackTo("repos")
                setPickerView("settings")
              }}
            />
          </div>
        )}
      </DialogContent>{" "}
    </Dialog>
  )
}
