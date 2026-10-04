import { createRoot } from "react-dom/client"

import "../styles.css"
import { Decisions, type Page, type Runs, type Surface } from "./decisions.tsx"

// Globals from the page's data script (data.js), which agents fill
declare const PAGE: Page
declare const SURFACES: Surface[]
declare const RUNS: Runs

createRoot(document.getElementById("app")!).render(
  <Decisions page={PAGE} surfaces={SURFACES} runs={RUNS} />
)
