/**
 * Shared text styling for `/`-skill and `@`-doc mentions.
 *
 * The same treatment is applied in four places — the composer chip, the
 * rendered user-message reference, the in-doc `@`-mention node view, and the
 * doc's serialized/static render — so it lives here once and they all stay in
 * sync when it changes. Mentions are plain inline text (no pill, icon, or
 * background); the leading `/` or `@` is the only marker.
 *
 * `no-underline` is included because the mention can render inside prose where
 * a stray link underline would otherwise apply; it's a harmless no-op on the
 * non-prose surfaces.
 */

/**
 * Base variant — for normal surfaces (light fill in light mode, dark in dark):
 * the composer and in-doc mentions.
 */
export const MENTION_TEXT_CLASS = "text-sky-600 no-underline dark:text-sky-400"

/**
 * Inverted variant — for the user-message bubble, whose fill is inverted (dark
 * in light mode, light in dark mode), so the sky shades flip to keep contrast.
 */
export const MENTION_TEXT_CLASS_INVERTED =
  "text-sky-400 no-underline dark:text-sky-600"
