import { useMDXComponents as getThemeComponents } from "nextra-theme-docs"
import { LinkArrowIcon } from "nextra/icons"
import type { MDXComponents } from "nextra/mdx-components"
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react"
import { Callout } from "./components/callout"
import {
  ArchitectureDiagram,
  ConceptsDiagram,
} from "./components/diagram/diagrams"
import { FileTree } from "./components/file-tree"
import { Only } from "./components/only"
import { Screenshot, ScreenshotRow } from "./components/screenshot"

const themeComponents = getThemeComponents()
const ThemeLink = themeComponents.a!
const ThemeTr = themeComponents.tr ?? "tr"

/** An environment variable's name, the only thing in a row's first cell. */
const ENV_VAR = /^[A-Z][A-Z0-9_]*$/

/** The variable a table row documents, when its first cell is just `NAME`. */
function rowVariable(children: ReactNode): string | null {
  const first = Children.toArray(children).find(isValidElement)
  if (!isValidElement<{ children?: ReactNode }>(first)) return null
  const cell = Children.toArray(first.props.children)
  if (cell.length !== 1 || !isValidElement(cell[0])) return null
  const name = text(cell[0])
  return ENV_VAR.test(name) ? name : null
}

/** A table's header labels, in column order. */
function headerLabels(children: ReactNode): string[] {
  const labels: string[] = []
  const walk = (node: ReactNode) =>
    Children.forEach(node, (child) => {
      if (!isValidElement<{ children?: ReactNode }>(child)) return
      if (child.type === "th" || child.type === themeComponents.th)
        labels.push(text(child.props.children))
      else walk(child.props.children)
    })
  walk(children)
  return labels
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(text).join("")
  if (isValidElement<{ children?: ReactNode }>(node))
    return text(node.props.children)
  return ""
}

export function useMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...themeComponents,
    ArchitectureDiagram,
    Callout,
    ConceptsDiagram,
    FileTree,
    Only,
    Screenshot,
    ScreenshotRow,
    // A full-width table in a scroll container, like the stock shadcn Table.
    // Nextra's own makes the table itself the scroller, so it can't fill the column.
    // `data-head` (the labels joined with "|") lets CSS size same-shape tables
    // alike; `--sp-head-N` carries each label for a phone's stacked rows.
    table: (props) => {
      const labels = headerLabels(props.children)
      const style: Record<string, string> = {}
      labels.forEach((label, i) => {
        if (label) style[`--sp-head-${i + 1}`] = JSON.stringify(label)
      })
      return (
        <div
          className="sp-table nextra-scrollbar"
          data-head={labels.join("|")}
          data-columns={labels.length}
          style={style}
        >
          <table {...props} />
        </div>
      )
    },
    // A row documenting one environment variable is linkable by its name,
    // with a # on hover like a heading's.
    tr: ({ children, ...props }) => {
      const name = rowVariable(children)
      if (!name) return <ThemeTr {...props}>{children}</ThemeTr>
      const [first, ...rest] = Children.toArray(children).filter(isValidElement)
      const cell = first as ReactElement<{ children?: ReactNode }>
      return (
        <ThemeTr id={name} className="sp-anchored-row" {...props}>
          {cloneElement(cell, undefined, [
            ...Children.toArray(cell.props.children),
            <a
              key="anchor"
              href={`#${name}`}
              className="x:focus-visible:nextra-focus subheading-anchor"
              aria-label={`Permalink for ${name}`}
            />,
          ])}
          {rest}
        </ThemeTr>
      )
    },
    // External links keep Nextra's arrow, but without the underlined
    // non-breaking space before it, and glued to the last word so it never
    // wraps onto a line of its own.
    a: ({ href, children, ...props }) => {
      if (
        typeof children !== "string" ||
        typeof href !== "string" ||
        !/^https?:\/\//.test(href)
      )
        return (
          <ThemeLink href={href} {...props}>
            {children}
          </ThemeLink>
        )
      const cut = children.lastIndexOf(" ") + 1
      return (
        <ThemeLink href={href} {...props}>
          {children.slice(0, cut)}
          <span className="sp-ext-link">
            {children.slice(cut)}
            <LinkArrowIcon height="1em" aria-hidden />
          </span>
        </ThemeLink>
      )
    },
    ...components,
  }
}
