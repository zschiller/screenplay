import { useMDXComponents as getThemeComponents } from "nextra-theme-docs"
import type { MDXComponents } from "nextra/mdx-components"
import { Callout } from "./components/callout"
import { Screenshot } from "./components/screenshot"

const themeComponents = getThemeComponents()

export function useMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...themeComponents,
    Callout,
    Screenshot,
    // A full-width table in a scroll container, like the stock shadcn Table.
    // Nextra's own makes the table itself the scroller, so it can't fill the column.
    table: (props) => (
      <div className="sp-table nextra-scrollbar">
        <table {...props} />
      </div>
    ),
    ...components,
  }
}
