# Capturing options on real screens

Reference for step 2 of [`design-exploration`](SKILL.md) for visual questions: how to shoot Today and each option on the real product without changing app code.

## Find the capture tool

Check for these in order:

1. A **screenshot harness** in the repo. Look for `package.json` scripts or folders named `screenshots`, `visual`, `snapshots` or `e2e`, and read its README. Prefer the seeded fixture world it boots over real data.
2. **Storybook** or a similar component workshop, when the question is about one component.
3. **Playwright** against the local dev server, from a scratch script. Log in or seed state through the app's own test helpers where they exist.

When no screen shows the state in question, add a scratch screen, story or fixture locally rather than drawing it. Shoot only the handful of screens where the thing appears, and keep runs short so a restart doesn't lose them.

## Restyling an option

Every option is Today plus an injected stylesheet or script, applied through a local patch or scratch script that is never committed. Save it in the scratchpad and record it in the exploration's topic file.

- **CSS**: inject with Playwright's `page.addStyleTag` just before the final settle. Styles an init script adds can be wiped by hydration. With Tailwind v4 or another layered CSS setup, unlayered `!important` rules beat the layered utilities.
- **Tokens**: override the CSS custom properties on `html` to restyle everything that reads them. Inline web fonts as data URLs so captures don't depend on the network.
- **JS**: use an init script passed as a string, skipping iframes (`window !== window.top`), to tag elements with a `data-` attribute for the CSS to target, or to swap icons.
- **Measuring**: have a script write each element's bounding box as JSONL. That gives exact sizes for the inventory and a way to check an option's alignment.

## Assembling the page

- Crop close-ups from the captures with a short script, so every option shows the same region at the same size and the detail still reads on a phone, where a capture is about 360px wide.
- Keep the page source and the crop script in the scratchpad. Publish captures through `files`, and reuse earlier rounds' files with `{artifact, path}` sources.
