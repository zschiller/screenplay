import { createRoot } from "react-dom/client"

import "../styles.css"
import { Storybook } from "./storybook.tsx"
import type { Control, Page, Render, State } from "./types.ts"

// Globals from the page's data script (data.js), which agents fill
declare const PAGE: Page
declare const CONTROLS: Control[]
declare const STATES: State[]

createRoot(document.getElementById("app")!).render(
  <Storybook
    page={PAGE}
    controls={CONTROLS}
    states={STATES}
    render={(window as { RENDER?: Render }).RENDER}
  />
)
