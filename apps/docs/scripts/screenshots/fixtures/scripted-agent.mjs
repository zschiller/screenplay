#!/usr/bin/env node
// A scripted stand-in for the Claude Code ACP adapter, used only to capture
// docs screenshots with deterministic conversations.
//
// The `npx` shim in ./bin launches this in place of
// `@agentclientprotocol/claude-agent-acp`, so Screenplay's real desktop path is
// exercised end to end: the external engine opens an ACP session, streams our
// `session/update`s into the chat, and routes a plan-mode permission request to
// the plan card. The file edits and git commands below are *really performed*
// in the workspace's worktree, so previews hot-reload and diff stats update.
//
// Speaks ACP JSON-RPC (newline-delimited) over stdio with no dependencies.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"

// --- Scenarios --------------------------------------------------------------
// Picked by matching the prompt text (first match wins). Steps: `say` streams
// agent text; `read`/`edit`/`run` are tool calls that really execute; `title`
// and `body` are document tool calls (rendered only — documents are seeded by
// the capture script); `plan` raises the plan-approval request.

const HERO_ROW = `<div className="row"><Link to="/pricing" className="btn">Start free trial</Link><a className="btn outline">Book a demo</a></div>`

const SCENARIOS = [
  {
    match: /Approved the plan/,
    steps: [
      { say: "Great — implementing the plan now." },
      {
        edit: "src/pages/Pricing.jsx",
        find: "      </section>\n    </main>",
        replace: `      </section>
      <section className="faq">
        <h2>Frequently asked questions</h2>
        {[["Can I change plans later?", "Yes — upgrade or downgrade at any time and we'll prorate the difference."], ["What counts as an event?", "Any tracked action: a page view, a click, or a custom event you send from your app."], ["Do you offer discounts for startups?", "Teams under two years old get 50% off Growth for their first year."], ["Is there a free trial?", "Every paid plan starts with a 14-day trial. No credit card required."]].map(([q, a]) => (
          <details key={q}><summary>{q}</summary><p>{a}</p></details>
        ))}
      </section>
    </main>`,
      },
      {
        edit: "src/styles.css",
        find: ".footer{",
        replace: `.faq{max-width:720px;margin:0 auto;padding:8px 24px 72px}.faq h2{font-size:28px;letter-spacing:-.03em;margin-bottom:18px;text-align:center}
.faq details{border-bottom:1px solid #eef0f4;padding:18px 4px}.faq summary{font-weight:600;cursor:pointer;list-style:none}.faq summary:before{content:"+";color:var(--accent);margin-right:10px;font-weight:700}.faq details[open] summary:before{content:"–"}.faq details p{color:#64748b;margin-top:10px;line-height:1.55}
.footer{`,
      },
      { run: ["git", "add", "-A"] },
      { run: ["git", "commit", "-m", "Add pricing FAQ"] },
      { run: ["git", "push", "-u", "origin", "HEAD"] },
      {
        say: "The FAQ is live below the plan cards — four questions, each a native `<details>` element, styled to match the page. Committed and pushed as `Add pricing FAQ`.",
      },
    ],
  },
  {
    match: /FAQ/,
    steps: [
      { say: "Let me look at the pricing page first." },
      { read: "src/pages/Pricing.jsx" },
      {
        plan: `## Add an FAQ to the pricing page

1. **Markup** — add a \`<section className="faq">\` below the plan cards in \`src/pages/Pricing.jsx\` with four questions:
   - Can I change plans later?
   - What counts as an event?
   - Do you offer discounts for startups?
   - Is there a free trial?
2. **Behavior** — render each item as a native \`<details>\` so it expands without extra JavaScript.
3. **Styles** — add \`.faq\` rules to \`src/styles.css\`: a centered 720px column, hairline dividers, and the accent color on the open item's marker.
4. Commit and push.`,
      },
    ],
  },
  {
    match: /checklist/i,
    steps: [
      { say: "Here's a first draft — edit anything you like and I'll keep it in sync." },
      { title: "Pricing launch checklist" },
      { body: true },
      {
        say: "Drafted **Pricing launch checklist** with before, during and after sections. Tell me if you want owners or dates on each item.",
      },
    ],
  },
  {
    match: /gradient/i,
    steps: [
      { say: "I'll start by looking at the hero markup and styles." },
      { read: "src/pages/Home.jsx" },
      { read: "src/styles.css" },
      {
        say: "The headline is a plain `h1` inside `.hero`, and the accent comes from the `--accent` variable the Accent color knob sets. I'll add the trust line under the buttons and give the headline a gradient.",
      },
      {
        edit: "src/pages/Home.jsx",
        find: HERO_ROW,
        replace: `${HERO_ROW}\n        <p className="trust">Trusted by 4,000+ product teams</p>`,
      },
      {
        edit: "src/styles.css",
        find: ".pill{",
        replace:
          ".hero h1{background:linear-gradient(90deg,var(--accent),#06b6d4);-webkit-background-clip:text;background-clip:text;color:transparent}\n.hero .trust{margin:18px auto 0;font-size:13px;color:#94a3b8;font-weight:500}\n.pill{",
      },
      { run: ["git", "add", "-A"] },
      { run: ["git", "commit", "-m", "Gradient hero headline and trust line"] },
      { run: ["git", "push", "-u", "origin", "HEAD"] },
      {
        say: 'Done — the preview has already reloaded:\n\n- **Headline** now uses a left-to-right gradient from the accent color to cyan. It follows the **Accent color** knob, so you can try other colors live.\n- **Trust line** — "Trusted by 4,000+ product teams" sits under the buttons in a muted 13px style.\n\nCommitted and pushed as `Gradient hero headline and trust line`.',
      },
    ],
  },
  { match: /./, steps: [{ say: "Done." }] },
]

// --- JSON-RPC plumbing --------------------------------------------------------

let nextId = 1
const pending = new Map()
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n")
const request = (method, params) =>
  new Promise((resolve) => {
    const id = `agent-${nextId++}`
    pending.set(id, resolve)
    send({ id, method, params })
  })
const notify = (method, params) => send({ method, params })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const sessions = new Map() // sessionId -> { cwd, mode, cancelled }
let toolSeq = 0

async function update(sessionId, update) {
  notify("session/update", { sessionId, update })
}

async function say(sessionId, text) {
  for (const word of text.match(/\S+\s*/g) ?? []) {
    if (sessions.get(sessionId)?.cancelled) return
    await update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: word } })
    await sleep(18)
  }
}

const textContent = (text) => [{ type: "content", content: { type: "text", text } }]
const numbered = (s) =>
  s.replace(/\n$/, "").split("\n").map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join("\n")

async function tool(sessionId, { title, kind, rawInput }, execute) {
  const toolCallId = `toolu_${Date.now().toString(36)}_${++toolSeq}`
  await update(sessionId, { sessionUpdate: "tool_call", toolCallId, title, kind, status: "pending", rawInput })
  await update(sessionId, { sessionUpdate: "tool_call_update", toolCallId, status: "in_progress", title, rawInput })
  await sleep(250)
  let content, status = "completed"
  try {
    content = await execute()
  } catch (e) {
    status = "failed"
    content = textContent(String(e.message ?? e))
  }
  await update(sessionId, { sessionUpdate: "tool_call_update", toolCallId, status, content, rawInput })
  await sleep(300)
}

async function runScenario(sessionId, promptText) {
  const s = sessions.get(sessionId)
  const scenario = SCENARIOS.find((sc) => sc.match.test(promptText))
  for (const step of scenario.steps) {
    if (s.cancelled) return "cancelled"
    const abs = (p) => path.join(s.cwd, p)
    if (step.say) await say(sessionId, step.say)
    else if (step.read)
      await tool(sessionId, { title: "read_file", kind: "read", rawInput: { path: step.read } }, () =>
        textContent(numbered(fs.readFileSync(abs(step.read), "utf8")))
      )
    else if (step.edit)
      await tool(
        sessionId,
        { title: "edit_file", kind: "edit", rawInput: { path: step.edit, old_string: step.find, new_string: step.replace } },
        () => {
          const before = fs.readFileSync(abs(step.edit), "utf8")
          if (!before.includes(step.find)) throw new Error(`old_string not found in ${step.edit}`)
          fs.writeFileSync(abs(step.edit), before.replace(step.find, step.replace))
          return [{ type: "diff", path: step.edit, oldText: step.find, newText: step.replace }]
        }
      )
    else if (step.run)
      await tool(
        sessionId,
        { title: "run_command", kind: "execute", rawInput: { command: step.run[0], args: step.run.slice(1) } },
        () => {
          let out
          try {
            out = execFileSync(step.run[0], step.run.slice(1), { cwd: s.cwd, encoding: "utf8", stdio: "pipe" })
          } catch (e) {
            out = `${e.stdout ?? ""}${e.stderr ?? ""}`
          }
          return textContent(`${out.trim()}\n[exit 0]`)
        }
      )
    else if (step.title)
      await tool(sessionId, { title: "set_document_title", kind: "edit", rawInput: { title: step.title } }, () =>
        textContent("ok")
      )
    else if (step.body)
      await tool(sessionId, { title: "replace_document_body", kind: "edit", rawInput: {} }, () =>
        textContent("ok")
      )
    else if (step.plan) {
      // Screenplay's plan gate: the engine turns this into the plan card and
      // winds the turn down; approval arrives later as a fresh prompt.
      const toolCallId = `toolu_plan_${Date.now().toString(36)}`
      await request("session/request_permission", {
        sessionId,
        toolCall: {
          toolCallId,
          title: "Review plan",
          kind: "other",
          status: "pending",
          content: textContent(step.plan),
          rawInput: { plan: step.plan },
        },
        options: [
          { optionId: "approve", name: "Approve", kind: "allow_once" },
          { optionId: "reject", name: "Request changes", kind: "reject_once" },
        ],
      })
      return "end_turn"
    }
  }
  return "end_turn"
}

// Match scenarios against the latest user message only: a fresh session's
// prompt leads with the system prompt (which can quote documents), then the
// replayed history, so the last text block is what the user just sent.
const promptText = (prompt) => {
  const texts = (prompt ?? []).map((b) => (b.type === "text" ? b.text : b.resource?.text ?? "")).filter(Boolean)
  return texts.at(-1) ?? ""
}

async function handle(msg) {
  const { id, method, params } = msg
  const reply = (result) => send({ id, result })
  switch (method) {
    case "initialize":
      return reply({ protocolVersion: 1, agentCapabilities: { loadSession: false }, authMethods: [] })
    case "authenticate":
      return reply({})
    case "session/new": {
      const sessionId = `sess_${Date.now().toString(36)}`
      sessions.set(sessionId, { cwd: params.cwd, mode: "default", cancelled: false })
      return reply({
        sessionId,
        modes: {
          currentModeId: "default",
          availableModes: [
            { id: "default", name: "Default" },
            { id: "plan", name: "Plan Mode" },
          ],
        },
      })
    }
    case "session/set_mode":
      if (sessions.has(params.sessionId)) sessions.get(params.sessionId).mode = params.modeId
      return reply({})
    case "session/set_config_option":
    case "session/set_model":
      return reply({})
    case "session/prompt": {
      const s = sessions.get(params.sessionId)
      s.cancelled = false
      const stopReason = await runScenario(params.sessionId, promptText(params.prompt))
      return reply({ stopReason: s.cancelled ? "cancelled" : stopReason })
    }
    case "session/cancel":
      if (sessions.has(params?.sessionId)) sessions.get(params.sessionId).cancelled = true
      return
    default:
      if (id !== undefined) send({ id, error: { code: -32601, message: `Method not found: ${method}` } })
  }
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return
  const msg = JSON.parse(line)
  if (msg.method) handle(msg).catch((e) => msg.id !== undefined && send({ id: msg.id, error: { code: -32603, message: String(e) } }))
  else if (pending.has(msg.id)) {
    pending.get(msg.id)(msg.result ?? msg.error)
    pending.delete(msg.id)
  }
})
