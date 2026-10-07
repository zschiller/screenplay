# Product docs

The user and self-hosting docs live in `apps/docs/content`.

## Keeping docs current

- A PR that changes what a user sees or configures updates the page that describes it in the same PR.
- If no page needs to change, the PR description says why on a `Docs: <reason>` line (see `.github/pull_request_template.md`). The Docs check (`.github/scripts/docs-check.mjs`) fails on a product-code PR with neither.
- A new environment variable goes in `self-hosting/environment-variables.mdx` (`apps/app/test/env-docs.test.ts` enforces it).
- Screenshots refresh themselves after merge (`.github/workflows/docs-screenshots.yml`); new screens are added in `apps/app/screenshots/docs/`.
- Diagrams are SVG components drawn with the kit in `apps/docs/components/diagram/kit.tsx` (see its header), never ASCII in a code block.

## Curly quotes

UI, homepage and docs copy uses curly apostrophes and quotes (’ “ ” ‘), never straight ' and ".

- The app’s `test/smart-quotes.test.ts` and `pnpm --filter docs test` / `pnpm --filter homepage test` fail on a straight one in copy.
- `pnpm exec smart-quotes --fix <folder>` from the app curls them (`packages/smart-quotes`).
