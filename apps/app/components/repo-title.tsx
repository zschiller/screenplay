import { repoListTitle, type RepoNaming } from "@/lib/repo-identity"

/** A repository row's title: `owner/name`, then its label muted (H5). */
export function RepoTitle({ repo }: { repo: RepoNaming }) {
  const { heading, label } = repoListTitle(repo)
  return (
    <>
      {heading}
      {label && (
        <span className="font-normal text-muted-foreground"> {label}</span>
      )}
    </>
  )
}
