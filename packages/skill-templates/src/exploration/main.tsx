import { createRoot } from "react-dom/client"

import "../styles.css"
import { Exploration } from "./exploration.tsx"
import type { Page, Round, Today } from "./types.ts"

// Globals from the page's data script (data.js), which agents fill
declare const PAGE: Page
declare const TODAY: Today
declare const ROUNDS: Round[]

createRoot(document.getElementById("app")!).render(
  <Exploration page={PAGE} today={TODAY} rounds={ROUNDS} />
)
