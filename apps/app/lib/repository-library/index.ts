/**
 * The repository library (#1420): a person's Repositories (today's saved
 * `RepoConfig`s) and how Canvas Repos link to them. The Canvas half is pure
 * and runs against any room Y.Doc; the store half and its migration run on
 * the server (`./actions` for callers, `./store` for the KV).
 */
export {
  canvasRepositoryRows,
  linkCanvasRepos,
  linkedRepo,
  sameRepository,
  switchOff,
  switchOn,
  type CanvasRepositoryRow,
  type SwitchOffResult,
} from "./canvas"
export {
  createRepositoryLibrary,
  type CanvasRooms,
  type RepositoryLibrary,
  type RepositoryLibraryDeps,
  type RepositoryStore,
} from "./library"
