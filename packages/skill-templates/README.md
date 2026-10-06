# Skill templates

The HTML pages the design skills publish, built from React with the app's real components (`@workspace/ui`), tokens and fonts. Each template lands in two places:

- **The repo skill** (`.agents/skills/design-exploration/exploration-template.html`, `.agents/skills/design-audit/audit-template.html` and `decisions-template.html`, `.agents/skills/design-storybook/storybook-template.html`): one self-contained page, so it publishes as an Artifact.
- **The App Skill** (`apps/app/lib/skills/<skill>/`, named by `skill` in `templates.ts`): a data page (`<name>-template.html`), the runtime it loads (`<name>-runtime.js`, the bundle's script and styles) and the skill's `fonts.css` (the page's fonts as data URLs, from `fonts/`). The page names the runtime as `skill:<skill>/<name>-runtime.js`, which the canvas swaps in when it renders the page as a Mockup, so a Mockup only stores a few KB plus its data.

```sh
pnpm --filter @workspace/skill-templates dev    # http://localhost:5173: every template with its sample data, hot reloading
pnpm --filter @workspace/skill-templates build  # writes the committed pages
```

Commit the built files with the source change: the package's test fails when any of them is out of date.

## How a page is put together

Each template is a folder in `src/` with its React entry (`main.tsx`) and sample data (`data.js`). `lib/page.ts` assembles the page the same way in dev and in the build:

1. A readable top an agent fills: the title, the Google Fonts link, the token block, and `data.js` as a plain `<script>` declaring the globals (`PAGE`, `ROUNDS`…) the entry reads.
2. The `Generated below this line` marker.
3. The bundle: one IIFE and its CSS, inlined, so the page is a single file an Artifact can publish. The App Skill's page has a `<script src="skill:…">` here instead, and links `skill:<skill>/fonts.css` in place of Google Fonts, since a Mockup loads nothing from the network.

A `skill:` or `files:` reference only resolves where it's written in the page's markup, not where the runtime builds it later (a capture in the data renders as a plain path).

The skills stay repo-agnostic: another repo swaps the token block (shadcn variable names, light under `:root`, dark under `.dark`) and the font link, and fills the data. The token values come from `packages/ui/src/styles/tokens.css`, trimmed to the variables the page uses; the bundle carries none of them, so the block is their only source.

## Shared state

Every template wires its UI state (picks, notes, the open tab or option) through `@screenplay.space/state`, so on a Screenplay canvas every viewer of the page sees the same picks. The package is inert unless the page is framed, and only runs in development builds, so `lib/build.ts` switches its gate on for these production pages. A new template should share its state the same way.

In dev, any capture the sample data names (`r2/a-light.png`) is served as a labelled placeholder.

## On a canvas

A Mockup gets the `screenplay` bridge, which `src/shared/chat.ts` wraps. Pass `send` to `CopyBar` and its button reads Send to chat on a canvas, putting the same text in the chat's composer (`screenplay.draft`); as an Artifact it copies. A pick never answers the chat's question card by itself: the person picks as long as they like, and Send to chat drafts every pick at once, in Copy's format, into the chat whose card is open, so sending it answers the card. When that card asks about one of the page's questions (its id starts the card's question, or its option labels match), the page opens on that question, and an answer on the card shows as the pick. While the page can’t reach the chat (the page is live, or the agent is driving it), the question says “Answer in the chat” (`AnswerInChat`). The page adds no label and never scrolls: the agent asks one card per call, so either would fire on every card. `src/shared/choices.tsx` draws a question's options as the app's question card does.

## Adding a template

1. Add `src/<name>/main.tsx` and `src/<name>/data.js`, and an entry to `templates.ts` naming its output file.
2. Import shared components from `@workspace/ui`; when you import one the templates haven't used yet, add it to the `@source` line in `src/styles.css`, or its classes won't be built.
3. Run the build and commit the pages and runtime.
