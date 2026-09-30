# Design rules

Reference for step 1 of [`design-exploration`](SKILL.md) and stage 0 of [`design-audit`](../design-audit/SKILL.md): where to find the owner's design rules in whatever repo you're in, and what to collect. Write the list into the exploration's or audit's memory topic file, and note the source of each rule.

## Where rules live

Read these in order. When two sources disagree, the newer one wins.

1. **Memory**: the owner's design rules, rejected directions, and "don't re-raise" lists. These are usually the newest.
2. **Agent docs**: `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, and any `docs/` pages they point to.
3. **Design system**: the component library (search for `components.json`, a `packages/ui` or `design-system` package, or a Storybook), the tokens or theme file (CSS custom properties, `tailwind.config.*`, a `theme.ts`), and the fonts the app loads.
4. **The product itself**: the patterns main already uses where no doc says otherwise. Two uses of a pattern make it a convention.

## What to collect

- **Restraint**: how much change the owner accepts, whether small fixes inside the current UX are preferred over redesigns, and which tools' conventions to follow.
- **Type and size**: the type scale, the faces, the weights for active states, and icon and control sizes.
- **Colour**: the palette, how each hue may be used (ink, outline, fill), status colours, and the surfaces for floating UI.
- **Components**: the library, whether custom variants are allowed, and loading, keyboard-hint, toast and empty-state conventions.
- **Product**: things the UI never shows, placements the owner has fixed, and surfaces that must stay as they are.
- **PR evidence**: the screenshots or recordings a build PR carries, the formats, and where the images are stored.

The list is done when each category has either its rules or "none found", with a source for every rule.
