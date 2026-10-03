/**
 * Icons the app never uses, in any product, whatever they would stand for.
 * Sparkle and Sparkles are the generic "AI" mark; a step, a skill or a
 * thought gets an icon that says what it is instead (Zack, 2026-10-03).
 */
const SPARKLE =
  "Never use a sparkle icon. Pick one that says what the thing is."

export const bannedIconRules = {
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@workspace/ui/components/icons",
            importNames: ["SparkleIcon", "SparklesIcon"],
            message: SPARKLE,
          },
          {
            name: "@phosphor-icons/react",
            importNames: ["Sparkle", "SparkleIcon"],
            message: SPARKLE,
          },
          {
            name: "lucide-react",
            importNames: ["Sparkle", "Sparkles", "SparkleIcon", "SparklesIcon"],
            message: SPARKLE,
          },
        ],
        patterns: [
          {
            group: ["@phosphor-icons/react/**/Sparkle"],
            message: SPARKLE,
          },
        ],
      },
    ],
  },
}
