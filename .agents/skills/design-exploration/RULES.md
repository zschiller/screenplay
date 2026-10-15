# Design rules

Reference for step 1 of [`design-exploration`](SKILL.md) and stage 0 of [`design-audit`](../design-audit/SKILL.md): where to find the owner's design rules in whatever repo you're in, and what to collect. Note the source of each rule in the list. The list is for checking options and findings against; the rules stay in their sources, so don't copy it into memory.

## Where rules live

Read these in order. When two sources disagree, the newer one wins.

1. **Design guide**: the repo's own guide to its design rules and rejected directions, usually reached from `AGENTS.md` (in Screenplay, [`docs/design/README.md`](../../../docs/design/README.md)). When it exists it is the main source, and its rejected list is the "don't re-raise" list.
2. **Design archive**: the READMEs of recent explorations, audits and storybooks on the archive branch ([`ARCHIVE.md`](ARCHIVE.md)), for picks and never-re-offer lists the owner gave since the guide was last updated. Read the index and open the folders that touch the same surface.
3. **Agent docs**: `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, and any other `docs/` pages they point to.
4. **Design system**: the component library (search for `components.json`, a `packages/ui` or `design-system` package, or a Storybook), the tokens or theme file (CSS custom properties, `tailwind.config.*`, a `theme.ts`), and the fonts the app loads.
5. **The product itself**: the patterns main already uses where no doc says otherwise. Two uses of a pattern make it a convention.

## What to collect

- **Restraint**: how much change the owner accepts, whether small fixes inside the current UX are preferred over redesigns, and which tools' conventions to follow.
- **Type and size**: the type scale, the faces, the weights for active states, and icon and control sizes.
- **Colour**: the palette, how each hue may be used (ink, outline, fill), status colours, and the surfaces for floating UI.
- **Components**: the library, whether custom variants are allowed, and loading, keyboard-hint, toast and empty-state conventions.
- **Product**: things the UI never shows, placements the owner has fixed, and surfaces that must stay as they are.
- **PR evidence**: the screenshots or recordings a build PR carries, the formats, and where the images are stored.

The list is done when each category has either its rules or "none found", with a source for every rule.
