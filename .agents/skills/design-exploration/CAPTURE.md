# Capturing options on real screens

Reference for step 2 of [`design-exploration`](SKILL.md), visual questions: how to shoot Today and each option from the screenshot harness (`apps/app/screenshots/README.md`) without changing app code.

## Shooting

- `pnpm screenshots:shots --screens a,b` shoots the named screens of the review world; `pnpm screenshots:docs --boot` serves the docs world and `pnpm screenshots:docs --no-frame --screens a,b` shoots against it. Positional arguments are ignored, so a run without `--screens` shoots everything.
- Screen names live in `apps/app/screenshots/screens.ts` and `docs/screens.ts`. When no screen shows the state in question, add a scratch screen or fixture locally rather than drawing it.
- A container restart kills a long run. Keep runs short and write output you need to the scratchpad.

## Restyling an option

Every option is Today plus an injected stylesheet or script, run through a local patch that is never committed. Save the patch in the scratchpad and record it in the exploration's topic file.

- **CSS**: in `apps/app/screenshots/lib/capture.ts`, `page.addStyleTag({ path })` from an env var (for example `EXPLORE_CSS`) just before the final settle. Styles added by an init script can be wiped by hydration. Unlayered `!important` rules beat Tailwind's layered utilities, so `.text-xs { font-size: 13px !important }` restyles every use.
- **Tokens**: override the CSS variables on `html` (`--font-instrument-serif`, `--success`, …) to restyle everything that reads them. Inline web fonts as woff2 data URLs so captures don't depend on the network.
- **JS**: an init script in `openThemedContext` (`lib/browser.ts`) passed as a string, not a function (tsx's `__name` helper breaks function init scripts), skipping frames with `window !== window.top`. Use it to tag elements (a `data-` attribute) for the CSS to target, or to swap icons by appending a nested svg inside each `svg.lucide` and hiding the original (give the nested svg `width` and `height` with `!important`, or `[&_svg]:size-*` shrinks it).
- **Measuring**: a script that writes each element's bounding box (and its first svg's) as JSONL gives exact sizes for the inventory and for checking an option's alignment.

## Assembling the page

- Crop close-ups from the 2x captures with a short script so each option shows the same region at the same size.
- Keep the page source and crop script in the scratchpad and publish captures through `files`, reusing earlier rounds' files with `{artifact, path}` sources.
