"use client"

import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import { cn } from "@workspace/ui/lib/utils"
import { nanoid } from "nanoid"
import { toast } from "sonner"
import {
  FolderOpenIcon,
  GlobeIcon,
  PlusIcon,
} from "@workspace/ui/components/icons"
import { Button } from "@workspace/ui/components/button"
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
import { resolveNewRepository } from "@/lib/add-repo/resolver"
import {
  PICKER_DIALOG_CLASS,
  PICKER_DIALOG_HEADER_CLASS,
} from "@/components/picker-dialog"
import { isLocalBuild } from "@/lib/local-mode"
import type { RepoConfig } from "@/lib/repo-configs.types"
import { sameRepository } from "@/lib/repository-library"
import {
  listRepositories,
  saveRepository,
} from "@/lib/repository-library/actions"

/** A human-readable label for a picker pick, for the settings-stage header. */
function pickLabel(pick: RepoPickerSelection): string {
  if (pick.kind === "repo") return pick.repo.fullName
  return pick.source.repoFullName || pick.source.localPath || "this repository"
}

/** The names of the Repositories you already have of the pick's repository. */
function repositoryNames(
  pick: RepoPickerSelection,
  repositories: readonly RepoConfig[]
): string[] {
  const fullName =
    pick.kind === "repo" ? pick.repo.fullName : pick.source.repoFullName
  const localPath = pick.kind === "source" ? pick.source.localPath : undefined
  return repositories
    .filter((r) =>
      fullName ? r.repoFullName === fullName : r.localPath === localPath
    )
    .map((r) => r.name)
}

/**
 * The add-repository flow's state (issues #604, #676, #781): which screen of
 * the dialog shows, and the pick waiting in the settings stage. Held by
 * whoever offers New repository (the canvas, Canvas settings, Settings) and
 * handed to {@link AddRepositoryDialog} and {@link AddRepositoryMenuItems}.
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
  // Your Repositories, so confirming a repository you already have updates
  // it rather than adding a second (the upsert's match, #681).
  const [repositories, setRepositories] = useState<RepoConfig[]>([])

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

  const open = pickerView !== null
  useEffect(() => {
    if (!open) return
    let cancelled = false
    listRepositories()
      .then((list) => {
        if (!cancelled) setRepositories(list)
      })
      // The save still upserts by identity on the server; this list only
      // lets the form keep a match's advanced fields.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open])

  return {
    open,
    pickerView,
    setPickerView,
    pendingPick,
    setPendingPick,
    settingsBackTo,
    setSettingsBackTo,
    folderInitial,
    repositories,
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
 * New repository (#1423), at the end of Canvas settings' list and on
 * Settings › Repositories: on desktop a menu of Open folder / Open GitHub
 * repository first (#604), on the web the GitHub picker straight away.
 */
export function NewRepositoryButton({
  flow,
  variant = "default",
}: {
  flow: AddRepositoryFlow
  variant?: "default" | "outline"
}) {
  const button = (
    <Button
      size="sm"
      variant={variant}
      onClick={isLocalBuild ? undefined : flow.openGitHub}
    >
      <PlusIcon />
      New repository
    </Button>
  )
  if (!isLocalBuild) return button
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        // Both items open a dialog (or the native folder picker); handing
        // focus back to the trigger would pull it out of that dialog.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <AddRepositoryMenuItems flow={flow} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The canvas's own add-repository flow (#1182), for every Add repository
 * outside Canvas settings: the empty canvas, the chat panel, the
 * getting-started checklist and the Chats menu. The canvas renders its
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
 * confirm-and-configure settings stage. Confirm saves the Repository to your
 * Repositories (#1423) and hands it to `onAdded`: a Canvas switches it on
 * there, Settings just shows it.
 */
export function AddRepositoryDialog({
  flow,
  onAdded,
}: {
  flow: AddRepositoryFlow
  /** Runs once the Repository is saved, with your Repositories after it. */
  onAdded: (repository: RepoConfig, repositories: RepoConfig[]) => void
}) {
  const {
    pickerView,
    setPickerView,
    pendingPick,
    setPendingPick,
    settingsBackTo,
    setSettingsBackTo,
    folderInitial,
    repositories,
    closePicker,
    stepBack,
  } = flow
  // The app a monorepo's Configure has chosen, held against the pick it was
  // chosen for so a later pick never inherits it.
  const [chosenApp, setChosenApp] = useState<{
    pick: RepoPickerSelection
    name: string
  } | null>(null)
  const appName =
    chosenApp && chosenApp.pick === pendingPick ? chosenApp.name : undefined
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
        className={PICKER_DIALOG_CLASS}
      >
        <DialogHeader
          className={cn(
            PICKER_DIALOG_HEADER_CLASS,
            // Configure's fields scroll under a hairline: give it the edit
            // dialogs' 12px above the line.
            pickerView === "settings" && "pb-3"
          )}
        >
          <DialogTitle>
            {pickerView === "settings"
              ? "Configure repository"
              : pickerView === "folder"
                ? "Open folder"
                : "Open GitHub repository"}
          </DialogTitle>
          {pickerView === "settings" && pendingPick && (
            <DialogDescription>
              {`Confirm the run settings for ${appName ? `${appName} in ` : ""}${pickLabel(pendingPick)} before it’s added.`}
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
                ? (baseline, appPath) =>
                    refineRepoSettings(
                      {
                        owner: pendingPick.repo.owner,
                        repo: pendingPick.repo.name,
                        ref: pendingPick.repo.defaultBranch,
                      },
                      baseline,
                      appPath
                    )
                : pendingPick.kind === "source" && pendingPick.source.localPath
                  ? (baseline, appPath) =>
                      refineFolderSettings(
                        {
                          localPath: pendingPick.source.localPath!,
                        },
                        baseline,
                        appPath
                      )
                  : undefined
            }
            // A monorepo's apps already added read "Added" in its App
            // picker, and the chosen one is named in the description.
            existingNames={repositoryNames(pendingPick, repositories)}
            onAppChange={(app) =>
              setChosenApp(app ? { pick: pendingPick, name: app.name } : null)
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
            onConfirm={(settings) => {
              const now = Date.now()
              const repository = resolveNewRepository(
                pendingPick,
                settings,
                repositories,
                { id: nanoid(), createdAt: now, updatedAt: now }
              )
              const label = pickLabel(pendingPick)
              // Saved first, so a Canvas switches on a Repository that
              // exists. The server upserts by identity too, so a list that
              // was stale here still lands on the one you already have.
              saveRepository(repository)
                .then((list) => {
                  const saved =
                    list.find((r) => r.id === repository.id) ??
                    list.find((r) => sameRepository(r, repository))
                  if (saved) onAdded(saved, list)
                })
                .catch(() => toast.error(`Couldn’t add ${label}.`))
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
              // The local build can add a Repo with no GitHub auth at
              // all — by clone URL (PRD #428).
              localSources={isLocalBuild}
              onSelect={(pick) => {
                // Every pick — a GitHub repo or a pasted clone-URL source —
                // goes through the confirm-and-configure settings stage
                // (#676, #682) before anything is saved.
                setPendingPick(pick)
                setSettingsBackTo("repos")
                setPickerView("settings")
              }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
