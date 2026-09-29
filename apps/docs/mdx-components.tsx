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
    ...components,
  }
}
