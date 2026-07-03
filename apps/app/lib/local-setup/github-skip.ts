/**
 * Whether the GitHub half of the first-run gate is currently skipped.
 *
 * ADR 0016's gate hard-requires a Harness (Step 1) and offers a **skippable**
 * GitHub Connection (Step 2). This vertical slice ships **Step 1 only**, so —
 * per the ADR — the GitHub half is *treated as satisfied* until the follow-up
 * slice adds Step 2 and the persisted skip cookie. Until then this is a constant
 * `true`, folded into the shared release predicate exactly where the real skip
 * bit will go: the next slice replaces it with the server-side cookie read
 * (default `false`) plus the Step 2 "Skip for now" that persists it.
 *
 * Keeping the release predicate built in full (`harnessSatisfied &&
 * (githubSatisfied || githubSkipped)`) means only this one knob changes when
 * Step 2 lands — the gate, the poll action, and the layout all stay put.
 */
export const githubSkippedForNow = true
