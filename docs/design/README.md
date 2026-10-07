# Design guide

How Screenplay looks, reads and behaves: the rules every UI change in `apps/app`, `packages/ui`, `apps/homepage` and `apps/docs` follows, and the directions already tried and turned down. Read it before designing, building or reviewing anything a person sees.

- Where a check enforces a rule, the rule names the check, and the check is the source of truth.
- When the product and a rule disagree, the rule wins: fix the product in the PR, or ask the owner when the fix is large.
- A direction under [Rejected](#rejected-directions) stays rejected. Build from what the owner asked for instead, and raise it again only when the owner does.

## Restraint

- Prefer a small fix inside today’s UX over a redesign. Spacing, type and hairlines carry a change, rather than heavier borders or rings.
- Use stock shadcn (Radix base, `radix-nova` in `components.json`) components, patterns and variants. Customise our copies in `packages/ui/src/components`, and ask the owner before adding a cva variant or a JS workaround. For a component we lack, start from shadcn’s own source.
- Buttons are real `Button`s, never styled links.
- Follow the conventions of other agentic tools (Claude, GitHub, Cursor), including GitHub’s PR colours with purple for merged.
- Before building chat UI, check shadcn’s chat components (Message, Bubble, Marker, Message Scroller, Attachment, Questionnaire) and name the one used.
- Decorative UI only shows behaviour the app has.
- A new mode hint or tag goes in existing chrome, never in a new pill style beside it.
- Creating something leaves focus where it was: nothing enters edit mode or takes focus on arrival (PR [#822](https://github.com/zschiller/screenplay/pull/822)).

## Type and size

- **Scale**: 12px meta (`text-xs`), 13px UI (`text-sm`), 14px `text-prose` for what’s said on the chat plane. When 12px applies is spelled out in the comment above `@theme` in [`apps/app/app/globals.css`](../../apps/app/app/globals.css); any sentence or clickable text is 13px. [`apps/app/lib/type-scale.test.ts`](../../apps/app/lib/type-scale.test.ts) fails on arbitrary or retired text sizes, UI text under 12px, and `h-* w-*` pairs where `size-*` belongs.
- **Faces**: titles in Unbounded at 27, 24, 20 and 17px; UI in Instrument Sans. A row uses one font throughout, never mono beside UI type.
- **One scale at a time**: elements shown side by side share a scale (UI or canvas), never a mix (PR [#1752](https://github.com/zschiller/screenplay/pull/1752)).
- **Active states** pair `font-medium` with `font-stretch-[98.8%]`, so a label keeps its width as it bolds. Static bold text needs only the weight.
- Code inside a heading scales with the heading.
- **Buttons**: icon buttons 28px with 16px icons. Text buttons are `sm` (28px, 13px label, 16px icon); `default` (32px) only in dialog footers and page actions (PR [#1720](https://github.com/zschiller/screenplay/pull/1720)). In the app, ESLint’s `design/button-size` (`packages/eslint-config/design-rules.js`) fails any Button size but `sm`, `icon-sm`, `default` and `lg`.
- **Icons**: Phosphor, imported from `@workspace/ui/components/icons` (the wrapper sets the weight and class). Light above 16px, Regular at 16px and under, stock weights only; dot glyphs and tiny state glyphs use Bold. PR state icons are the Lucide PR family at Phosphor’s stroke weight (PR [#1721](https://github.com/zschiller/screenplay/pull/1721)).
- **No sparkle icon**, in any product: pick an icon that says what the thing is. ESLint (`packages/eslint-config/banned-icons.js`, run in CI) fails on the import.

## Colour

- **Signal palette** (`packages/ui/src/styles/tokens.css`): each hue appears only as ink (text and icons), outline, or solid fill (`bg-*-fill`). Text and icons on a fill are black. Tints such as `bg-*/10` stay out, except diff lines, the inspect overlay and the stock destructive menu hover. In the app, ESLint’s `design/no-status-tint` fails a `/NN` opacity on success, warning, destructive, info or merged; the diff highlight carries the one disable comment.
- **Status**: ink for a standalone status; outline (border, regular text, coloured icon) for chips, badges and banners; fill for small marks (dots, pins, the record dot) and the Interact button. A badge’s text matches its icon colour. Error banners use red text; warnings keep regular text with an amber icon.
- **Idle controls are uncoloured**: red only while recording, not on an idle Record button.
- **Needs you** is the orange `NeedsYouDot` (`bg-attention-fill`), never a warning icon.
- **Dark mode**: the page is pure black, and every fill must read on it. Muted, secondary and accent sit at 0.25 lightness, popover at 0.175 (PR [#1690](https://github.com/zschiller/screenplay/pull/1690)); keep new dark fills at 0.2 or above.
- **Chats carry no colour** anywhere: no swatches, tinted names or coloured pills.
- **Text selection**: the app uses a softer hot pink under black (`apps/app/app/globals.css`); the homepage and docs keep magenta. Selected text, SVG `fill` included, is black (PR [#1736](https://github.com/zschiller/screenplay/pull/1736)).
- **Underlines** share one offset, `0.2em` on `html` in `packages/ui/src/styles/globals.css`; components set no `underline-offset-*` of their own.

## Components

- **Spinners**: the regular `Spinner` for loading and progress; the 9-dot `AgentActivityDots` only for agent activity (runs, streaming, thinking).
- **Kbd** is for keys only, one cap per key, in the UI font (`apps/app/test/kbd-keys-only.test.ts` fails on a mouse word). Pointer actions (Click, Drag) are plain muted text. Shortcuts go in a control’s tooltip, never in a hint row under a text box.
- **Surfaces**: tooltips, toasts, menus (`DropdownMenu`, `Select`) and the `@` and `/` lists in the composer and Documents are inverted (the `inverted` class). Searchable pickers built on `Command` (the chat picker, comboboxes) use the normal popover surface (`packages/ui/src/components/command.tsx`), as do popovers, hover cards and dialogs.
- **Menus** hug their widest item, 224px minimum, never wrap; the sizing lives in `packages/ui/src/components/dropdown-menu.tsx`, so individual menus set no width. Every item carries an icon. A checkmark column appears only when items are checkable. A menu leaves out what a tap already does (no “Open”).
- **One of a few choices** uses `Tabs`, not `ToggleGroup`.
- **List pickers in a dialog** use the repo picker’s chrome (`apps/app/components/picker-dialog.tsx`).
- **Row ⋯ actions** overlay the row’s end on hover with a 16px fade and never reserve space (`apps/app/components/panels/layer-rows/row-action.ts`).
- **Hover-revealed accessories** keep their place with `visibility`, not `display`, so nothing shifts. A name label never moves on selection or hover.
- **Dialogs**: body edges (fields, list rows, footer buttons) sit on the title’s 20px gutter. A dialog keeps its height across loading, empty and error states. A scrolling body goes in `DialogScrollBody` (`apps/app/components/scroll-hairline.tsx`), which drops its top padding and shows hairlines only while content is scrolled.
- **Settings sub-items** open as dialogs over Settings or Canvas settings; settings group labels are sentence case.
- **Confirm buttons** say the plain verb (Delete, Remove), even when an option widens the action. Destructive confirms use the stock `destructive` variant.
- **Approvals** (merge, saving a skill) use the AI Elements `Confirmation` (`packages/ui/src/components/confirmation.tsx`).
- **Deletes** that ⌘Z can undo happen at once, with no confirm and no toast. Other transient notices are toasts.
- **Empty states** say why, not just what (“Connect GitHub to see your repositories here.”).
- **Inline rename fields** open white with black text in both themes, using `editableTextFieldClass` from `@workspace/ui/components/editable-text`, and are never wider than what they rename.

## Product

- Git branches never show in the UI; a chat is known by its title. Git words appear only in git menus and the chat hover card.
- Terminals belong to their chat: they open in the pane under it, Preview first, then shells (`apps/app/lib/chat/terminal-pane.ts`). A coding harness runs as the chat itself.
- Picking a chat never moves the canvas or switches the page. Only a click on a specific layer (a mention, a Coordinator link) takes you to it.
- Layout gestures (drag, merge, split) never change which chat a frame shows; only explicit switchers do.
- A Group names a chat only when all its frames show the same one (PR [#1784](https://github.com/zschiller/screenplay/pull/1784)).
- Frame controls live in the bar under the selected frame. Detaching keeps Interact in place (PR [#1466](https://github.com/zschiller/screenplay/pull/1466)).
- Scroll in a shared frame stays shared between viewers.
- Canvas resize always works; handles hide only where they would overlap (PR [#1789](https://github.com/zschiller/screenplay/pull/1789)). Labels hide by layer width alone, under 64px (PR [#1788](https://github.com/zschiller/screenplay/pull/1788)).
- Frames, Mockups and Documents have square corners and no CSS border; their 1px stroke is painted in screen space (PR [#1786](https://github.com/zschiller/screenplay/pull/1786), [ADR 0027](../../apps/app/docs/adr/0027-screen-space-canvas-chrome.md)).
- Onboarding never drops a person into Canvas settings.
- Agents merge only through a confirm card a person presses ([ADR 0020](../../apps/app/docs/adr/0020-merges-only-by-a-persons-tap.md)).

## Copy

- **Enforced by `apps/app/lib/ui-copy`** ([`rules.ts`](../../apps/app/lib/ui-copy/rules.ts), checked by `ui-copy.test.ts` over the app, docs and homepage): canvas, repository and chat in place of the code’s room, repo and branch; “chat”, never “workspace”; “branch” only in sentences about git; the `…` character; “control”, not “drive”; “agent”, not “Claude”; “preview”, not “dev server”; “Remove”, not “Turn off”; “terminal”, not “shell”; “play mode”, not “prototype player”; and in docs, “Hosted” or “the hosted app”, never “web app”. The comment at the top of `rules.ts` gives each rule’s exceptions. The concept glossary and casing (lowercase product nouns mid-sentence, only Coordinator capitalised) are in [`apps/app/CONTEXT.md`](../../apps/app/CONTEXT.md).
- **Curly quotes and apostrophes** in all visible copy; the tests that enforce it are listed in [`docs/agents/product-docs.md`](../agents/product-docs.md#curly-quotes).
- The chat header’s button says “Create PR”; menus say “Create pull request”.
- A Hosted or Desktop badge in the docs goes under a heading or at the start of a cell or paragraph, never inside the heading.
- Plain words: say what the thing does, with no puns or themed wordplay.

## Homepage

- Always dark (a static `dark` class in `apps/homepage/app/layout.tsx`), with no theme toggle.
- Plain, confident copy; no app jargon (frame, Coordinator, chat header) in headlines.
- Product images are HTML excerpts of the app, not screenshots ([`apps/homepage/README.md`](../../apps/homepage/README.md#product-images-are-html)).
- Claim only what ships; [the claims the homepage must not make](../../apps/homepage/README.md#claims-the-homepage-must-not-make) are listed there.
- The hero dither is static; only the cursor’s fluid sim moves it.
- Illustration frame bars show back and forward, the route, the featured control and ⋯.

## Rejected directions

Each was built or mocked, shown to the owner and turned down. The source is the PR, issue or date where that happened.

- A top toolbar in play mode replacing the corner HUD (PR [#843](https://github.com/zschiller/screenplay/pull/843), 2026-09-28).
- Chat identity as a human title plus colour swatch, or a recoloured pill (PR [#830](https://github.com/zschiller/screenplay/pull/830), PR [#836](https://github.com/zschiller/screenplay/pull/836)).
- Frame rows with the route as muted mono text (PR [#850](https://github.com/zschiller/screenplay/pull/850)).
- Two-line rows ([#791](https://github.com/zschiller/screenplay/issues/791)).
- A chat picker drawn in the frame body (PR [#844](https://github.com/zschiller/screenplay/pull/844), [#798](https://github.com/zschiller/screenplay/issues/798)).
- A header bar attached to the frame, or a floating toolbar that lifts the name label ([#795](https://github.com/zschiller/screenplay/issues/795), 2026-09-28).
- A solid-red destructive Button variant (PR [#817](https://github.com/zschiller/screenplay/pull/817)).
- A status dot plus “PR #N ⌄” menu in the chat header (PR [#841](https://github.com/zschiller/screenplay/pull/841)).
- A flush, borderless repo picker inside a dialog (PR [#838](https://github.com/zschiller/screenplay/pull/838)).
- A muted Kbd hint row under text boxes ([#786](https://github.com/zschiller/screenplay/issues/786)).
- Terminals split away from their chat into a separate drawer (PR [#829](https://github.com/zschiller/screenplay/pull/829)).
- Darkroom (always-dark sidebar and chat), beige or tinted greys, and magenta as the selected state everywhere (visual language exploration, 2026-09-28).
- Title serifs Newsreader, Source Serif 4, Fraunces, Libre Caslon and Young Serif (2026-09-29).
- Bordered or filled mention chips, a magenta mention colour, and taller chat lines (PR [#1412](https://github.com/zschiller/screenplay/pull/1412)).
- A square Switch, a magenta on-state, or an outlined off-state (PR [#1471](https://github.com/zschiller/screenplay/pull/1471), 2026-10-03).
- The zigzag “Tidy” Knobs layout (PR [#1473](https://github.com/zschiller/screenplay/pull/1473)).
- Rejoin taking Interact’s place in the frame bar (PR [#1466](https://github.com/zschiller/screenplay/pull/1466)).
- Per-person scroll in shared frames (PR [#1532](https://github.com/zschiller/screenplay/pull/1532), reverted in PR [#1563](https://github.com/zschiller/screenplay/pull/1563)).
- Settings sub-views pushed onto a breadcrumb or expanded in the row; they open as dialogs (2026-10-03, PR [#1578](https://github.com/zschiller/screenplay/pull/1578)).
- Manual ordering, drag-to-reorder or a grouping toggle in the Chats menu (PR [#1455](https://github.com/zschiller/screenplay/pull/1455)).
- Skills menu rows grouped under headings or marked with source icons (PR [#1571](https://github.com/zschiller/screenplay/pull/1571)).
- A shared live instance by streaming or DOM mirroring ([#983](https://github.com/zschiller/screenplay/issues/983), [#982](https://github.com/zschiller/screenplay/issues/982), [ADR 0025](../../apps/app/docs/adr/0025-no-shared-live-instance.md)).
- A skill delete the agent can run, as a tool or a card (PR [#1680](https://github.com/zschiller/screenplay/pull/1680)).
- A Customize button, edit in place, or house rules for built-in skills; people ask the agent to copy one (PR [#1633](https://github.com/zschiller/screenplay/pull/1633)).
- An auto-inserted @ mention chip leading a page’s draft (PR [#1653](https://github.com/zschiller/screenplay/pull/1653)).
- Delegated chats inheriting the Coordinator’s plan mode (PR [#1755](https://github.com/zschiller/screenplay/pull/1755)).
- A needs-you dot after the Coordinator crumb (PR [#1537](https://github.com/zschiller/screenplay/pull/1537)).
- A Hands-only canvas toolbar with no Frame tool, or one prompt tool routed by the Coordinator ([#1355](https://github.com/zschiller/screenplay/issues/1355)).
- A one-line or blank empty canvas after creating one, or a canvas named after its first repository ([#1811](https://github.com/zschiller/screenplay/issues/1811)).
- Placeholder hint text or a `/` menu item for attaching files (PR [#1686](https://github.com/zschiller/screenplay/pull/1686)).
- Stacked PRs (2026-10-05).
- A mixed Phosphor and Lucide PR icon set, or stock 2px Lucide strokes (PR [#1721](https://github.com/zschiller/screenplay/pull/1721)).
- Frame status shrinking to fit, or UI and canvas scale side by side (PR [#1752](https://github.com/zschiller/screenplay/pull/1752)).
- Neutral grey, the system Highlight, or magenta ink with no fill for app text selection (PR [#1717](https://github.com/zschiller/screenplay/pull/1717)).
- The slow stirred-water launch spinner, dye trails and spirals (PR [#1749](https://github.com/zschiller/screenplay/pull/1749), reverted in PR [#1754](https://github.com/zschiller/screenplay/pull/1754)).
- A hairline status strip under the composer, or circled Stop and Run icons (PR [#1816](https://github.com/zschiller/screenplay/pull/1816)).
- A list of running previews inside the draw-a-frame card (2026-10-06).
- “Add to chat” as the Document selection label (PR [#1833](https://github.com/zschiller/screenplay/pull/1833)).
- An OKLCH brightness retune of the Signal palette (PR [#1778](https://github.com/zschiller/screenplay/pull/1778), 2026-10-06).
- Rounded frame corners (2026-10-06, PR [#1786](https://github.com/zschiller/screenplay/pull/1786)).
- Page names on Chats menu rows, or picking a chat jumping to its page (PR [#1854](https://github.com/zschiller/screenplay/pull/1854), 2026-10-07).

Long per-exploration lists (homepage hero, dither, headline fonts) live in that exploration’s folder on the `claude/design-archive` branch.

## PR evidence

- A PR that changes what people see shows before and after shots of the screens it touches, and only those, in light and dark. The [screenshot harness](../../apps/app/screenshots/README.md) captures them.
- Motion goes in a GIF plus an MP4, never a `.webm`.
- Images live on the orphan branch `claude/pr-screenshots`, which is never merged or force-pushed. Give files one dot (`name-light.png`) and link them by branch, not commit SHA (`raw.githubusercontent.com/zschiller/screenplay/claude/pr-screenshots/<dir>/<file>`): GitHub defangs two-dot names and SHA URLs in PR bodies.
- Measure layout before and after any state change: nothing may jump, spacing stays symmetric, and labels keep their full text.
- A defect visible in any shot of a touched screen is the PR’s to fix, even when main already has it; say so in the description.
