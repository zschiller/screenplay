import { FileTree as NextraFileTree } from "nextra/components"
import { FolderIcon } from "nextra/icons"
import { Children, type ComponentProps } from "react"

type FolderProps = ComponentProps<typeof NextraFileTree.Folder>

/**
 * Nextra's folder, except one listed without its contents is a plain row.
 * Nextra's toggles it anyway, which only swaps the icon, so it read as
 * broken. Folders with children still open and close.
 */
function Folder(props: FolderProps) {
  if (Children.count(props.children) > 0)
    return <NextraFileTree.Folder {...props} />
  return (
    <li className="x:flex x:items-center x:gap-1 x:break-all">
      <FolderIcon height="14" className="x:shrink-0" />
      {props.name}
    </li>
  )
}

/** Nextra's FileTree, full width and in the code font (see app/globals.css). */
export const FileTree = Object.assign(
  (props: ComponentProps<typeof NextraFileTree>) => (
    <NextraFileTree {...props} />
  ),
  { Folder, File: NextraFileTree.File }
)
