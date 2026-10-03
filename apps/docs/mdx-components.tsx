import { useMDXComponents as getThemeComponents } from "nextra-theme-docs"
import { LinkArrowIcon } from "nextra/icons"
import type { MDXComponents } from "nextra/mdx-components"
import { Children, isValidElement, type ReactNode } from "react"
import { Callout } from "./components/callout"
import {
  ArchitectureDiagram,
  ConceptsDiagram,
} from "./components/diagram/diagrams"
import { Screenshot } from "./components/screenshot"

const themeComponents = getThemeComponents()
const ThemeLink = themeComponents.a!

/** A table's header labels joined with "|", so CSS can size same-shape tables alike. */
function headerLabels(children: ReactNode): string {
  const labels: string[] = []
  const walk = (node: ReactNode) =>
    Children.forEach(node, (child) => {
      if (!isValidElement<{ children?: ReactNode }>(child)) return
      if (child.type === "th" || child.type === themeComponents.th)
        labels.push(text(child.props.children))
      else walk(child.props.children)
    })
  walk(children)
  return labels.join("|")
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
    Screenshot,
    // A full-width table in a scroll container, like the stock shadcn Table.
    // Nextra's own makes the table itself the scroller, so it can't fill the column.
    table: (props) => (
      <div
        className="sp-table nextra-scrollbar"
        data-head={headerLabels(props.children)}
      >
        <table {...props} />
      </div>
    ),
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
