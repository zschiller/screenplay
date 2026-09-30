"use client"

import Link from "next/link"
import { useConfig } from "nextra-theme-docs"
import { Button } from "@workspace/ui/components/button"
import { CaretLeftIcon, CaretRightIcon } from "@workspace/ui/components/icons"

/**
 * Previous and next page as the app's outline buttons, in place of Nextra's
 * pagination links, which layout.tsx turns off. Same neighbours as Nextra's:
 * the flattened sidebar, within the current docs tree.
 */
export function PageNav() {
  const { flatDocsDirectories, activeIndex } = useConfig().normalizePagesResult
  const prev = flatDocsDirectories[activeIndex - 1]
  const next = flatDocsDirectories[activeIndex + 1]
  const show = (page?: (typeof flatDocsDirectories)[number]) =>
    page?.isUnderCurrentDocsTree ? page : undefined
  const before = show(prev)
  const after = show(next)
  if (!before && !after) return null
  return (
    <nav aria-label="Pages" data-pagefind-ignore className="sp-page-nav">
      {before && (
        <Button variant="outline" asChild>
          <Link href={before.route} prefetch={false}>
            <CaretLeftIcon data-icon="inline-start" />
            {before.title}
          </Link>
        </Button>
      )}
      {after && (
        <Button variant="outline" asChild className="ms-auto">
          <Link href={after.route} prefetch={false}>
            {after.title}
            <CaretRightIcon data-icon="inline-end" />
          </Link>
        </Button>
      )}
    </nav>
  )
}
