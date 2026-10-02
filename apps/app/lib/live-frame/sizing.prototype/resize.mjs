#!/usr/bin/env node
// PROTOTYPE (#1384), not for main. What "growing" a Workspace Sandbox costs: create a persistent
// 2-vCPU Sandbox with a running process, raise it to 4 vCPUs, and time stop → resume. Checks whether
// the new size needs a restart and whether running processes survive.
import { Sandbox } from "@vercel/sandbox"
const t = () => performance.now()
const sb = await Sandbox.create({ resources: { vcpus: 2 }, timeout: 15 * 60 * 1000, keepLastSnapshots: { count: 1, deleteEvicted: true }, snapshotExpiration: 24 * 3600 * 1000 })
const nproc = async () => (await (await sb.runCommand("bash", ["-lc", "nproc; pgrep -f '[s]leep 9999' >/dev/null && echo alive || echo gone"])).stdout()).trim().replace("\n", " ")
try {
  await sb.runCommand({ cmd: "bash", args: ["-lc", "head -c 300000000 /dev/urandom > big.bin"] }) // ~300 MB of files, like node_modules
  await sb.runCommand({ cmd: "sleep", args: ["9999"], detached: true })
  console.log("before:", await nproc())
  let t0 = t(); await sb.update({ resources: { vcpus: 4 } }); console.log(`update ${Math.round(t() - t0)} ms; running session now:`, await nproc())
  t0 = t(); await sb.stop({ blocking: true }).catch(() => sb.stop()); const stopMs = Math.round(t() - t0)
  t0 = t(); const after = await nproc(); console.log(`stop ${stopMs} ms, resume to first command ${Math.round(t() - t0)} ms; after:`, after)
  t0 = t(); const r = await sb.runCommand("bash", ["-lc", "ls -la big.bin | awk '{print $5}'"]); console.log("files kept:", (await r.stdout()).trim())
} finally {
  await sb.stop().catch(() => {})
  await sb.delete?.().catch(() => {})
  console.log("cleaned up", sb.name)
}
