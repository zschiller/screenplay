import { NotFoundPage } from "nextra-theme-docs"
import { LinkArrowIcon } from "nextra/icons"

// Nextra's 404 in the docs chrome and type, instead of Next's unstyled default.
// The link's arrow is ours, glued to the last word like every external link
// (see mdx-components), not Nextra's underlined space and arrow.
export default function NotFound() {
  return (
    <NotFoundPage
      content={
        <>
          Report this broken{" "}
          <span className="sp-ext-link">
            link
            <LinkArrowIcon height="1em" aria-hidden />
          </span>
        </>
      }
    >
      <h1 className="sp-not-found">This page could not be found</h1>
    </NotFoundPage>
  )
}
