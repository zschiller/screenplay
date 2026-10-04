# Skill templates

The HTML pages the design skills publish (`.agents/skills/design-exploration/exploration-template.html`, `.agents/skills/design-audit/audit-template.html` and `decisions-template.html`), built from React with the app's real components (`@workspace/ui`), tokens and fonts.

```sh
pnpm --filter @workspace/skill-templates dev    # http://localhost:5173: every template with its sample data, hot reloading
pnpm --filter @workspace/skill-templates build  # writes the committed pages
```

Commit the built pages with the source change: the package's test fails when a page is out of date.

## How a page is put together

Each template is a folder in `src/` with its React entry (`main.tsx`) and sample data (`data.js`). `lib/page.ts` assembles the page the same way in dev and in the build:

1. A readable top an agent fills: the title, the Google Fonts link, the token block, and `data.js` as a plain `<script>` declaring the globals (`PAGE`, `ROUNDS`…) the entry reads.
2. The `Generated below this line` marker.
3. The bundle: one IIFE and its CSS, inlined, so the page is a single file an Artifact can publish.

The skills stay repo-agnostic: another repo swaps the token block (shadcn variable names, light under `:root`, dark under `.dark`) and the font link, and fills the data. The token values come from `packages/ui/src/styles/tokens.css`, trimmed to the variables the page uses; the bundle carries none of them, so the block is their only source.

In dev, any capture the sample data names (`r2/a-light.png`) is served as a labelled placeholder.

## Adding a template

1. Add `src/<name>/main.tsx` and `src/<name>/data.js`, and an entry to `templates.ts` naming its output file.
2. Import shared components from `@workspace/ui`; when you import one the templates haven't used yet, add it to the `@source` line in `src/styles.css`, or its classes won't be built.
3. Run the build and commit the page.
