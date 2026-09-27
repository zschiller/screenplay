// One command for the whole docs screenshot pipeline.
//
//   node run.mjs all [--fresh]   boot → seed → capture → frame
//   node run.mjs boot [--fresh]  start the app (local build) with fixtures
//   node run.mjs seed            build the demo scene
//   node run.mjs capture [...]   capture scenes (args as for capture.mjs)
//   node run.mjs frame [names]   write framed WebPs into apps/docs/public
//   node run.mjs stop            stop the app and the capture browser
//
// See README.md next to this file.
import { spawnSync } from "node:child_process"
import path from "node:path"
import { TOOL_DIR } from "./lib/env.mjs"
import { boot, stopApp } from "./boot.mjs"
import { stopBrowser } from "./lib/browser.mjs"

const [cmd = "all", ...rest] = process.argv.slice(2)
const node = (script, args = []) => {
  const r = spawnSync(process.execPath, [path.join(TOOL_DIR, script), ...args], { stdio: "inherit" })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

switch (cmd) {
  case "boot":
    await boot({ fresh: rest.includes("--fresh") })
    break
  case "seed":
    node("seed.mjs")
    break
  case "capture":
    node("capture.mjs", rest)
    break
  case "frame":
    node("frame.mjs", rest)
    break
  case "stop":
    stopApp()
    await stopBrowser()
    break
  case "all":
    await boot({ fresh: rest.includes("--fresh") })
    node("seed.mjs")
    node("capture.mjs")
    node("frame.mjs")
    break
  default:
    console.error(`Unknown command "${cmd}". Try: all | boot | seed | capture | frame | stop`)
    process.exit(1)
}
