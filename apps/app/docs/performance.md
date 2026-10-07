# Canvas performance

How to measure the canvas’s cost and what earlier rounds of tuning learned. The canvas was made 3–5× cheaper for drags, marquee and drawing (PR #1764), then for frame resize (PRs #1767, #1768); read this before changing anything on a gesture’s hot path.

## Measuring

1. **Use a production build.** `next dev` costs are dominated by dev-only work and mislead. Seed the fixture world (`pnpm screenshots:seed`), then run `next build` and `next start --port 3947` with the capture profile’s env (`captureEnv` in `screenshots/profile.ts`). The screenshot harness itself runs `next dev` (`screenshots/lib/server.ts`), so it can’t be used for timing as is.
2. **Make the room busy.** Pan and zoom are cheap on any room because rendering is deferred; costs show on a canvas with dozens of layers. The 54-layer bench tiled the fixture Checkout canvas 2×3.
3. **Drive real input.** Send about 120 CDP input events (`Input.dispatchMouseEvent`), one per animation frame, for the gesture under test.
4. **Read CDP deltas.** Take `Performance.getMetrics` before and after and compare script, style recalc and layout durations, plus the count of long frames.
5. **Find what re-renders.** An init script that defines `__REACT_DEVTOOLS_GLOBAL_HOOK__` can count commits per component.
6. **Throttle the CPU** (`Emulation.setCPUThrottlingRate`, rate 4) to find frames that only drop on slower machines.

Trust the JS, style and layout numbers. Canvas and raster costs measured in a cloud container come from SwiftShader and don’t reflect a real GPU. WebKit lays out iframes on the canvas’s own thread, so resize costs on a Mac differ from Chromium’s; confirm WebKit-specific wins on a Mac.

Keep bench scripts outside the repo. A `.ts` file left in `screenshots/screens/scratch/` is loaded as a screen and breaks the screens test.

## Lessons

**Keep props stable.** Most of the wins came from stopping whole lists re-rendering on every gesture step:

- `lib/canvas/stable-props.ts` (`StableProps`) keeps per-item props referentially stable so `memo`’d Layers and sidebar rows bail out. `useStableValue` does the same for one value.
- Pass narrowed fields, not whole layer arrays. Each resize step writes the doc, and anything subscribed to every layer re-rendered with it: the sidebar, the mention lists, and a context value rebuilt on every render that woke about 80 menu components.
- Give list rows context rather than a component factory; a factory remounts rows on unrelated edits.
- The React compiler lint rejects `stable.value()` on memoized deps; passing the value as a hook argument is fine.

**Keep forced style and layout reads off the hot path.**

- rzpp re-measures (a forced layout) on every `TransformWrapper` render, so it lives in the memoized `CanvasTransform` in `components/canvas/canvas.tsx`, with the content passed through context.
- `resolveCanvasColor` (`lib/canvas/tokens.ts`) caches each colour until the theme changes; it used to cost a `getComputedStyle` per colour per redraw.
- Any change to the canvas wrapper’s `cursor` restyles every element under it (about 1,500, 13–25ms). Never flip it on a press without movement: a pan arms on press and only shows the grabbing cursor once the pointer moves (`use-canvas-camera.ts`).
- The selection overlay is sized to what it draws (`measureDraw`, `lib/canvas/draw-bounds.ts`), not the whole view.

**Resizing a frame.** Resizing is the only gesture that changes an iframe’s size, and a heavy page re-lays out at each size. `useFollowedSize` in `components/canvas/live-page.tsx` takes the latest size each animation frame but waits for a short frame (up to 100ms) when the page falls behind, so the drag never stalls behind the page.

**Dead ends** (tried, made things worse or didn’t help):

- Wrapping gesture dispatch in `flushSync`.
- Coalescing resize dispatch to `requestAnimationFrame`: it split React commits.
- Moving the overlay canvas instead of redrawing it: drags almost never only translate.

**Known remaining cost:** about 3 Canvas root commits per move while dragging a group, and native work re-uploading the view-sized overlay canvases.
