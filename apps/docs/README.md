# Docs site

The product and self-hosting docs at [screenplay.space/docs](https://screenplay.space/docs): a Next app on [Nextra 4](https://nextra.site) (`nextra-theme-docs`). Pages are MDX under `content/`; the theme and every override of Nextra’s look are in `app/layout.tsx` and `app/globals.css`.

```sh
pnpm --filter docs dev     # http://localhost:3002/docs (PORT overrides)
pnpm --filter docs build   # next build, then the Pagefind search index
pnpm --filter docs test    # fails on a straight quote or apostrophe in copy
```

The site is served under `basePath: "/docs"` (`next.config.mjs`), so a page is at `localhost:3002/docs/guides/quickstart`, not `/guides/quickstart`. The homepage project proxies `/docs/*` here in production (`apps/homepage/vercel.json`).

What goes in the docs, the `Docs:` line on PRs, screenshots and diagrams are covered in the root `AGENTS.md`. This file is about the site itself.

## Styling Nextra

- **Nextra’s CSS sits in cascade layers**, so a plain rule in `globals.css` beats it without `!important`. The brand hue and page background are set on `<Head>` in `app/layout.tsx`; fonts and radii are the unlayered `--x-font-*` and `--x-radius-*` overrides at the top of `globals.css`.
- **A few Nextra rules are unlayered and win anyway.** The step headings rule (`.nextra-steps h3:not([style^="visibility:"])`) is one: override it with a more specific selector (`article .nextra-steps h3:not(…)`).
- **Article text colour has specificity 0,1,2.** `article :is(p, li, td, h1, h2, h3):not(.nextra-callout *)` forces the body colour, so a muted-text override inside an article needs the `article` prefix too (`article .nextra-card > p`, not `.nextra-card > p`).
- **Nextra paints some surfaces on a wrapper**, not the element you’d expect. The footer’s grey is on the `div` around `footer` (`div:has(> footer)`).
- **The search hint can’t be replaced by a prop.** Nextra’s `Search` renders its own `<kbd>`; `globals.css` hides its text and draws ⌘K or Ctrl K with `::before` and `::after` (`kbd:has(> span)` is the Mac case). There are two `.nextra-search` elements (desktop and mobile), so a Playwright locator needs `:visible`.
- **Classes with a colon are escaped**: the sidebar’s active link is `a.x\:bg-primary-100`.

## Code blocks

Code blocks use the terminal’s ANSI palette (`@workspace/ui/lib/ansi-palette`) so they match the app’s terminal. `ansi-code-theme.mjs` is a Shiki theme whose colours are `var(--ansi-N)`, and `app/layout.tsx` defines those variables from the palette in a `<style>` inside `<Head>`.

`next.config.mjs` can’t import the palette’s `.ts` file (Node runs the config without type stripping), which is why the theme points at variables rather than holding hex values. Nextra reads both `--shiki-light` and `--shiki-dark`, so the theme is passed for both.

## Search

Search is [Pagefind](https://pagefind.app), indexed from the prerendered pages by `search-index.mjs` after `next build` and written to `public/_pagefind` (gitignored). On Vercel the build adapter has already copied `public/` into its deploy output by then, so the script also writes the index to `.next/output/static/docs/_pagefind`; without that the live site has no index and search fails to load. `pnpm dev` doesn’t build the index, so search finds nothing in dev unless a build has run before. Elements marked `data-pagefind-ignore` (the page nav, Copy page) stay out of the index.

## Before and after shots

For a styling change, run `next build && next start` (or `pnpm dev`) on `main` in a worktree and on your branch, and shoot both with `playwright-core` against Chromium at `/opt/pw-browsers/chromium` in a cloud container. Wait only for images in the viewport: lazy images below the fold never load. Hide `nextjs-portal` in dev shots.

The product screenshots inside pages come from the app’s harness (`pnpm --filter app screenshots:docs`, see `apps/app/screenshots/README.md`) and refresh themselves after merge.
