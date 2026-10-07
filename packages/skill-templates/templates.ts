// Every template this package builds. `src/<name>/` holds its React entry
// (main.tsx) and its sample data (data.js), which the built page carries as
// the data script an agent fills. `out` is the committed page, relative to
// the repo root, with the bundle inlined so it publishes as an Artifact.
// `skill` is the App Skill that ships the template as a Mockup folder's page,
// its sample data script, and a runtime file the page loads with a `skill:`
// reference (see appOutputs).

export type Template = {
  name: string
  title: string
  about: string
  out: string
  skill: string
}

/** The App Skill folders, relative to the repo root. */
export const APP_SKILLS = "apps/app/lib/skills"

/**
 * Where a template lands in its App Skill: the page a Mockup folder holds as
 * its `index.html`, the sample data the page loads from the folder as
 * `data.js` (#1889), the runtime (script and styles) its `src` names, and the
 * fonts its stylesheet link names (one file per Skill), as files of the Skill.
 */
export function appOutputs(t: Template) {
  const runtime = `${t.name}-runtime.js`
  return {
    page: `${APP_SKILLS}/${t.skill}/${t.name}-template.html`,
    data: `${APP_SKILLS}/${t.skill}/${t.name}-data.js`,
    /** Where the page loads its data from, beside it in the Mockup's folder. */
    dataRef: "data.js",
    runtime: `${APP_SKILLS}/${t.skill}/${runtime}`,
    ref: `skill:${t.skill}/${runtime}`,
    fonts: `${APP_SKILLS}/${t.skill}/fonts.css`,
    fontsRef: `skill:${t.skill}/fonts.css`,
  }
}

export const templates: Template[] = [
  {
    name: "exploration",
    title: "{{TITLE}}",
    about:
      "Design exploration page. Fill PAGE, TODAY and ROUNDS in the data script; the page renders from them.",
    out: ".agents/skills/design-exploration/exploration-template.html",
    skill: "screenplay-design-exploration",
  },
  {
    name: "audit",
    title: "{{TITLE}}",
    about:
      "Design audit findings page. Fill PAGE, DEPTHS, NOTICES, FINDINGS and EXTRA in the data script; the page renders from them.",
    out: ".agents/skills/design-audit/audit-template.html",
    skill: "screenplay-design-audit",
  },
  {
    name: "decisions",
    title: "{{TITLE}}",
    about:
      "Design audit decisions page. Fill PAGE, SURFACES and RUNS in the data script; the page renders from them.",
    out: ".agents/skills/design-audit/decisions-template.html",
    skill: "screenplay-design-audit",
  },
  {
    name: "storybook",
    title: "{{TITLE}}",
    about:
      "Design storybook page. Fill PAGE, CONTROLS and STATES in the data script; the page renders from them.",
    out: ".agents/skills/design-storybook/storybook-template.html",
    skill: "screenplay-design-storybook",
  },
]
