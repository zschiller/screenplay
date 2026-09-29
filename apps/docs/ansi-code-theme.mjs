/**
 * The Shiki theme for docs code blocks: the terminal's ANSI palette
 * (`@workspace/ui/lib/ansi-palette`), so code reads in the same colours as the
 * app's terminal tab and logs panel. Each role points at an `--ansi-N`
 * variable, which app/layout.tsx defines per theme from the palette itself,
 * so one theme serves light and dark and the hex values live in one place.
 *
 * The scopes follow Shiki's GitHub themes, which the docs used before (#1104).
 */
const ansi = (index) => `var(--ansi-${index})`

// Anything no rule below claims keeps the page's text colour.
const foreground = "currentColor"

const roles = [
  // Comments: bright black.
  [["comment", "punctuation.definition.comment", "string.comment"], ansi(8)],
  // Numbers, constants and built-ins: cyan.
  [
    [
      "constant",
      "entity.name.constant",
      "variable.other.constant",
      "variable.other.enummember",
      "variable.language",
      "support",
      "support.constant",
      "support.variable",
      "meta.property-name",
      "meta.module-reference",
      "string variable",
      "markup.inline.raw",
    ],
    ansi(6),
  ],
  // Functions, types and component names: blue.
  [["entity", "entity.name"], ansi(4)],
  // Parameters and variables: yellow.
  [["variable", "variable.parameter"], ansi(3)],
  [
    ["variable.other", "storage.modifier.package", "storage.modifier.import"],
    foreground,
  ],
  // Tags: red.
  [["entity.name.tag", "invalid", "message.error", "markup.deleted"], ansi(1)],
  // Keywords: magenta.
  [["keyword", "storage", "storage.type"], ansi(5)],
  // Strings: green.
  [
    [
      "string",
      "punctuation.definition.string",
      "string punctuation.section.embedded source",
      "source.regexp",
      "string.regexp",
      "markup.inserted",
    ],
    ansi(2),
  ],
  [["markup.heading", "markup.heading entity.name"], ansi(6)],
]

/** @type {import("shiki").ThemeRegistration} */
export const ansiCodeTheme = {
  name: "screenplay-ansi",
  type: "dark",
  fg: foreground,
  bg: "transparent",
  settings: [
    { settings: { foreground, background: "transparent" } },
    ...roles.map(([scope, color]) => ({
      scope,
      settings: { foreground: color },
    })),
  ],
}
