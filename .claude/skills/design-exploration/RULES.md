# Standing design rules

Reference for step 1 of [`design-exploration`](SKILL.md): the owner's standing design rules, copied from project memory when this file was last edited. Memory is newer where the two differ. [`design-audit`](../design-audit/SKILL.md)'s visual nits depth checks against the same rules.

## Restraint

- Prefer a small fix inside the current UX over a redesign.
- Keep visual changes restrained: no heavy borders or rings.
- Use stock shadcn (Radix, radix-nova) components, patterns and variants. Customise our copies in `packages/ui/src/components`; add no new cva variants or JS workarounds without asking. Buttons are real `Button`s, not styled links.
- Follow other agentic tools' conventions (Claude, GitHub), including GitHub's PR colours with purple for merged.
- Decorative UI never implies behaviour the app lacks.
- Place a new mode hint or tag in existing chrome; a new pill style beside the canvas chrome is the pattern the owner rejected.

## Type and size

- UI text is 12 or 14px. Titles are Unbounded at 27, 24, 20 and 17px; UI text is Instrument Sans.
- Active states use `font-medium` with `font-stretch-[98.8%]` so bold labels keep their width.
- Code inside a heading scales with the heading.
- Icon buttons are 28px with 16px icons.

## Colour

- The Signal neon palette: ink for text and icons, outline, and fill. No tints. Text or icons on a solid fill are black, never white.
- Status badge text is one shade calmer than its icon.
- The Workspace carries no colour anywhere.
- Tooltips, toasts and menus use inverted surfaces. Floating UI matches the shared floating toolbar surface.
- Inline rename fields open white (foreground colour) in both themes, and every inline rename matches.

## Components

- `Kbd` is for keys only, one cap per key, in the UI font. Pointer actions (Click, Drag) are plain muted text.
- Loading uses the regular spinner; the 9-dot spinner means LLM activity only.
- Confirm buttons keep the plain verb (Delete, Remove).
- Transient notices are toasts. Empty states say why, not just what.

## Product

- Git branches never show in the UI; a Workspace is known by its title.
- Onboarding never drops a person into Canvas settings.
- Terminal tabs sit alongside chat tabs.
- Leave Workspace pills alone.
- The homepage is always dark, with plain copy.

## Build PRs that follow a pick

- Before and after screenshots of the touched screens only, in light and dark. Motion goes in a GIF plus an MP4, never webm.
- Screenshot images live on the orphan branch `claude/pr-screenshots`, which is never merged or force-pushed.
- Any defect visible in a PR's shots is that PR's to fix.
