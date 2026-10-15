import fs from "node:fs"
const S = (o) => Object.entries(o).map(([k, v]) => `${k.replace(/[A-Z]/g, m => "-" + m.toLowerCase())}:${v}`).join(";")
const T = { fg: "var(--foreground)", mu: "var(--muted-foreground)", bd: "var(--border)", bg: "var(--background)", m: "var(--muted)", ring: "var(--ring)" }

// A site preview inside a frame, drawn as grey blocks.
const preview = `<div style="${S({ display: "flex", flexDirection: "column", gap: "6px", padding: "8px", height: "100%", boxSizing: "border-box" })}">
 <div style="${S({ display: "flex", justifyContent: "space-between", fontSize: "8px", color: T.mu })}"><b style="color:${T.fg};font-weight:600">checkout-polish</b><span>Shop · Cart</span></div>
 <div style="${S({ height: "34px", background: T.fg, opacity: ".14", borderRadius: "2px" })}"></div>
 <div style="${S({ height: "40px", border: `1px solid ${T.bd}`, borderRadius: "2px" })}"></div>
 <div style="${S({ height: "26px", border: `1px solid ${T.bd}`, borderRadius: "2px" })}"></div>
</div>`
const loading = `<div style="${S({ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", color: T.mu })}">Loading preview…</div>`
const nochat = `<div style="${S({ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "6px", fontSize: "11px", color: T.mu })}"><b style="color:${T.fg};font-weight:500">No chat</b><span style="border:1px solid ${T.bd};padding:2px 6px;color:${T.fg}">Start a chat</span></div>`

function frame({ chat, body = "", selected = true, h = 150 }) {
  const label = `<div style="${S({ display: "flex", gap: "6px", fontSize: "10px", color: T.mu, marginBottom: "3px", whiteSpace: "nowrap" })}"><span style="color:${selected ? T.ring : T.fg}">Frame</span><span>${chat ? chat + " ⌃" : "Choose a chat ⌃"}</span></div>`
  return `<div style="${S({ width: "150px", margin: "0 auto" })}">${label}<div style="${S({ height: h + "px", background: body ? T.bg : T.m, border: `1px solid ${selected ? T.ring : T.bd}` })}">${body}</div></div>`
}
const float = (inner, w = "200px") => `<div style="${S({ width: w, maxWidth: "100%", margin: "8px auto 0", background: T.bg, border: `1px solid ${T.bd}`, boxShadow: "0 4px 14px rgb(0 0 0 / .14)", padding: "6px", boxSizing: "border-box", fontSize: "11px", color: T.fg })}">${inner}</div>`
const btn = (t, primary) => `<span style="${S({ display: "inline-flex", alignItems: "center", height: "20px", padding: "0 7px", border: `1px solid ${primary ? T.fg : T.bd}`, background: primary ? T.fg : "transparent", color: primary ? T.bg : T.fg, whiteSpace: "nowrap" })}">${t}</span>`
const composer = (chip, send = "↑", text = "") => float(`<div style="color:${text ? T.fg : T.mu};padding:2px 2px 10px">${text || "What should this frame show?"}</div><div style="display:flex;justify-content:space-between;align-items:center"><span>${chip} ⌄</span>${btn(send, true)}</div>`)
const row = (t, on, muted) => `<div style="${S({ padding: "4px 6px", background: on ? T.m : "transparent", color: muted ? T.mu : T.fg, display: "flex", justifyContent: "space-between", whiteSpace: "nowrap", overflow: "hidden" })}">${t}</div>`
const menu = (rows, q = "Search running previews…") => float(`<div style="color:${T.mu};padding:2px 6px 6px;border-bottom:1px solid ${T.bd};margin-bottom:4px">${q}</div>${rows.join("")}`, "210px")

const step = (n, cap, inner) => `<figure style="${S({ margin: "0", display: "flex", flexDirection: "column", gap: "8px", minWidth: "0" })}">
 <div style="${S({ background: T.bg, border: `1px solid ${T.bd}`, padding: "14px 10px", height: "300px", boxSizing: "border-box", overflow: "hidden" })}">${inner}</div>
 <figcaption style="${S({ fontSize: "13px", lineHeight: "1.4", color: T.fg })}"><b style="font-weight:600">${n}</b> ${cap}</figcaption></figure>`
const strip = (steps) => `<div style="${S({ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "20px 16px" })}">${steps.join("")}</div>`
const paths = (rows) => `<table style="${S({ width: "100%", borderCollapse: "collapse", fontSize: "13px", marginTop: "8px" })}"><thead><tr><th style="text-align:left;padding:6px 8px 6px 0;font-weight:600;border-bottom:1px solid ${T.bd}">What you want</th><th style="text-align:left;padding:6px 0;font-weight:600;border-bottom:1px solid ${T.bd}">What you do</th></tr></thead><tbody>${rows.map(([a, b]) => `<tr><td style="padding:6px 8px 6px 0;vertical-align:top;border-bottom:1px solid ${T.bd};color:${T.mu}">${a}</td><td style="padding:6px 0;vertical-align:top;border-bottom:1px solid ${T.bd}">${b}</td></tr>`).join("")}</tbody></table>`
const wrap = (s, p) => `<div style="display:flex;flex-direction:column;gap:12px;width:min(520px, calc(100vw - 72px));min-width:0">${s}${p}</div>`

const A = wrap(strip([
  step("1", "Draw a frame.", frame({ chat: "" })),
  step("2", "It shows the likely running preview at once, at that chat’s route. A small bar under it says which, until you click away.", frame({ chat: "Checkout polish", body: preview }) + float(`<div style="display:flex;gap:6px;align-items:center;justify-content:space-between"><span style="color:${T.mu};white-space:nowrap;overflow:hidden">Checkout polish ⌄</span>${btn("New chat")}</div>`)),
  step("3a", "Wrong one: the chat name opens the searchable list of running previews; picking one swaps it.", frame({ chat: "Checkout polish", body: preview }) + menu([row("Checkout polish ✓", true), row("Empty cart state"), row("Order receipt email")])),
  step("3b", "New chat empties the frame and turns the bar into today’s composer, New chat already picked.", frame({ chat: "" }) + composer("New chat")),
]), paths([
  ["Show the likely preview", "Nothing. Draw and it’s there."],
  ["Show a different preview", "Chat name in the bar, pick one (or type to filter)."],
  ["Start a new chat here", "New chat, type, Enter."],
  ["Ask an existing chat for a change", "Not from the draw: use the chat panel."],
  ["Leave the frame empty", "⌘Z the preview, or New chat then Esc."],
]))

const B = wrap(strip([
  step("1", "Draw a frame.", frame({ chat: "" })),
  step("2", "The running-previews menu opens under it, search focused, the likely one first and highlighted. New chat sits at the bottom.", frame({ chat: "" }) + menu([row("Checkout polish", true), row("Empty cart state"), row("Order receipt email"), `<div style="border-top:1px solid ${T.bd};margin:4px 0"></div>` + row("+ New chat…")])),
  step("3a", "Enter (or a click) shows that preview and closes the menu.", frame({ chat: "Checkout polish", body: preview })),
  step("3b", "New chat… turns the menu into today’s composer. Typing words no chat matches makes that row read New chat: “…”.", frame({ chat: "" }) + composer("New chat")),
]), paths([
  ["Show the likely preview", "Enter."],
  ["Show a different preview", "Type to filter or arrow down, Enter."],
  ["Start a new chat here", "New chat…, type, Enter."],
  ["Ask an existing chat for a change", "Not from the draw: use the chat panel."],
  ["Leave the frame empty", "Esc, as today."],
]))

const C = wrap(strip([
  step("1", "Draw a frame.", frame({ chat: "" })),
  step("2", "Today’s card, but the chip starts on the likely running chat and, while the box is empty, the button reads Show.", frame({ chat: "" }) + composer("Checkout polish", "Show")),
  step("3a", "Enter on the empty box shows that preview. Nothing is sent.", frame({ chat: "Checkout polish", body: preview })),
  step("3b", "Typing turns Show back into Send: the words go to the chip’s chat, as today. For a new chat, switch the chip to New chat first.", frame({ chat: "" }) + composer("Checkout polish", "↑", "Make the summary sticky")),
]), paths([
  ["Show the likely preview", "Enter."],
  ["Show a different preview", "Chip, pick one, Enter."],
  ["Start a new chat here", "Chip, New chat, type, Enter (one step more than today)."],
  ["Ask an existing chat for a change", "Type, Enter, as today."],
  ["Leave the frame empty", "Esc, as today."],
]))

const data = `<script>
const IMG=(p,cap,dk)=>({p,cap,dk});
const PAGE={
 date:"6 October 2026",
 slug:"draw-frame-preview-or-chat",
 quote:"When you make a new frame on the canvas, usually you want to open a view into a running preview; sometimes (rarely) you want to prompt a new chat for a code change.",
 q:"What should drawing a frame do, so showing a running preview is effortless and starting a new chat is still one step away?"
};
const TODAY={facts:[
 "Drawing a frame opens the chat composer centred on it (352px card): “What should this frame show?”, with a chip that starts on <b>New chat</b>, or on the chat of whatever you had selected (<code>frame-ask-card.tsx</code>, <code>use-draw-ask.ts:156</code>).",
 "Picking a chat in the chip doesn’t show it: Enter still sends your words to that chat, and the frame takes its preview only then (<code>use-draw-ask.ts:216</code>).",
 "To just show a running preview you press Esc, then use “Choose a chat” in the frame’s 12px title (<code>iframe-layer-label.tsx:238</code>). That’s the common case, and it takes the most steps.",
 "One path already skips the question: with the Frame tool, clicking a Group’s + slot adds a frame that copies the last frame’s chat, route and size, no card (<code>use-group-actions.ts:167</code>).",
 "Screen-space floating UI (the card, menus) reads the same at any zoom; the frame’s own title shrinks with the canvas."
],shots:[IMG("today/card.light.png","Today · Drawing a frame opens the composer, New chat picked"),IMG("today/chip.light.png","Today · With a frame selected first, the chip starts on its chat, but Enter still sends"),IMG("today/esc.light.png","Today · Esc leaves an empty frame; Choose a chat is in its title")]};
const ROUNDS=[
{n:1,feedback:"",every:[
 "<b>Running preview</b>: a chat whose preview is up (not stopped, failed or done). <b>The likely one</b>: the chat of what you had selected before drawing, else the chat open in the chat panel, else the chat used most recently.",
 "Showing a chat in the frame copies the route of that chat’s newest frame. The frame’s size stays the viewport.",
 "With no running preview on the canvas, drawing opens today’s composer card, unchanged.",
 "The Mockup tool doesn’t change."
],questions:[
 {key:"draw",title:"Drawing a frame",intro:"Each option is a storyboard of the flow, then every path through it.",options:[
  {id:"A",name:"Show the likely one",why:"The common case costs nothing: draw, and the preview you most likely meant is there. A small bar under the frame names it and offers the two ways out, change it or start a new chat. It’s the same rule the Group’s + slot already follows, extended to a drawn frame.",cost:"A wrong guess loads a preview for everyone on the canvas before you change it. The bar is a new small floating piece beside the card. Asking an existing chat for a change from the draw goes away (the chat panel covers it).",rec:true,state:"",html:${JSON.stringify(A)}},
  {id:"B",name:"Pick from the running previews",why:"Drawing asks which preview, with the likely one already highlighted, so Enter is the whole common case and nothing loads that you didn’t choose. New chat is the last row, so the rare case is still one click away.",cost:"Always one keystroke, even when only one preview is running. The menu is a searchable list, so it grows with the number of chats. Asking an existing chat for a change from the draw goes away.",state:"",html:${JSON.stringify(B)}},
  {id:"C",name:"Today’s card, Enter shows",why:"The smallest change: the card stays, the chip starts on the likely running chat, and Enter on an empty box shows it. Everything the card does today still works.",cost:"The common case still looks like a prompt, and “Enter on an empty box shows” is easy to miss. Starting a new chat takes one step more than today (switch the chip). The send button gets a new Show state.",state:"",html:${JSON.stringify(C)}}
 ]}
]}
];
</script>`
const tpl = fs.readFileSync(process.argv[2], "utf8")
const i = tpl.indexOf("<script>\nconst IMG")
const j = tpl.indexOf("</script>", i) + "</script>".length
let out = tpl.slice(0, i) + data + tpl.slice(j)
out = out.replace("<title>{{TITLE}}</title>", "<title>Drawing a frame</title>")
fs.writeFileSync("draw-frame.html", out)
console.log(i, j, out.length)
