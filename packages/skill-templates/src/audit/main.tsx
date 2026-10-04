import { createRoot } from "react-dom/client"

import "../styles.css"
import {
  Audit,
  type Depth,
  type Extra,
  type Finding,
  type Notice,
  type Page,
} from "./audit.tsx"

// Globals from the page's data script (data.js), which agents fill
declare const PAGE: Page
declare const DEPTHS: Depth[]
declare const NOTICES: Notice[]
declare const FINDINGS: Finding[]
declare const EXTRA: Extra[]

createRoot(document.getElementById("app")!).render(
  <Audit
    page={PAGE}
    depths={DEPTHS}
    notices={NOTICES}
    findings={FINDINGS}
    extra={EXTRA}
  />
)
