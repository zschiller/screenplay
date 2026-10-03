/**
 * The repository library (#1420): a person's Repositories (today's saved
 * `RepoConfig`s) and how Canvas Repos link to them. The Canvas half is pure
 * and runs against any room Y.Doc; the store half and its migration run on
 * the server (`./actions` for callers, `./store` for the KV).
 */
export {
  applyRepositoryEdit,
  canvasRepositoryGroups,
  canvasRepositoryRows,
  isCustomized,
  linkCanvasRepos,
  linkedRepo,
  repositorySettings,
  resetToRepository,
  runSettings,
  sameRepository,
  switchOff,
  switchOn,
  switchOnWithEnv,
  unlinkRepository,
  type CanvasRepositoryGroup,
  type CanvasRepositoryRow,
  type RunSettings,
  type SwitchOffResult,
} from "./canvas"
export {
  createRepositoryLibrary,
  type CanvasEnv,
  type CanvasRooms,
  type RepositoryLibrary,
  type RepositoryLibraryDeps,
  type RepositoryStore,
} from "./library"
export {
  desktopLinkPolicy,
  hostedLinkPolicy,
  repositoryLinkPolicy,
  type RepositoryLinkPolicy,
} from "./link-policy"
