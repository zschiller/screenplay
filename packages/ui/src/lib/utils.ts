import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The theme's title sizes (`--text-title-*` in globals.css) are font sizes.
// Without this, tailwind-merge reads `text-title-md` as a text colour and drops
// it next to `text-foreground`. Any new `--text-*` size token goes here too.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["title-xl", "title-lg", "title-md", "title-sm"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
