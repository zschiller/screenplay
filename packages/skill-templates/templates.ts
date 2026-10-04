// Every template this package builds. `src/<name>/` holds its React entry
// (main.tsx) and its sample data (data.js), which the built page carries as
// the data script an agent fills. `out` is the committed page, relative to
// the repo root.

export type Template = {
  name: string
  title: string
  about: string
  out: string
}

export const templates: Template[] = [
  {
    name: "exploration",
    title: "{{TITLE}}",
    about:
      "Design exploration page. Fill PAGE, TODAY and ROUNDS in the data script; the page renders from them.",
    out: ".agents/skills/design-exploration/exploration-template.html",
  },
]
