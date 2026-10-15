const IMG=(p,cap,dk)=>({p,cap,dk});
const SCREENS=[["canvas-agent-chat","Finished turn"],["canvas-plan-review","Plan review"],["canvas-chat-question","Question card"],["chat-coordinator","Coordinator, empty"]];
const shotsFor=(o,label)=>SCREENS.map(([s,n])=>IMG(`shots/${s}.${o}.light.png`,`${label} · ${n}`,`shots/${s}.${o}.dark.png`));
const PAGE={
 date:"2026-10-05",
 slug:"chat-panel-spacing",
 quote:"overall the chat sidebar feels a bit dense w/ the margin. can we do some visual refinement",
 q:"How much room should the chat panel give its content at the edges and between messages?"
};
const TODAY={facts:[
 "Shot on main plus <a href=\"https://github.com/zschiller/screenplay/pull/1722\">PR #1722</a> (tool rows and pills at 14px), so the options sit on the type sizes that are about to land. Panel at its default 30% split: 453px wide in a 1512px window.",
 "Every edge is <b>12px</b>: the header row (<code>chat-panel-header.tsx:28</code> px-3), the message column (<code>agent-chat.tsx:445</code> p-3), the composer (<code>composer.tsx:601</code> p-3) and the terminal footnote’s Stop button (<code>terminal-pane.tsx:401</code> pr-3).",
 "Messages are <b>16px</b> apart (<code>agent-chat.tsx:460</code> space-y-4), whether the next item is the same turn’s tool row or a new turn.",
 "Your message bubble is padded <b>6px × 12px</b> and up to 85% wide (<code>agent-message.tsx:1262</code>). Tool rows sit at the 12px edge with their caret, text at 30px.",
 "The composer has a hairline above it, 12px above and to the sides, and 4px under it when the terminal footnote shows (<code>terminal-pane.tsx:310</code>). The footnote’s first dot sits about 12px in.",
 "The left sidebar already uses 16px on its left edge, so the chat panel is the tighter of the two."
],shots:shotsFor("today","Today")};
const ROUNDS=[
{n:1,feedback:"",every:[
 "Only padding and gaps change. No component, size or colour changes, and every state of the panel (Workspace chat, Coordinator, plan, question) gets the same edge, so nothing moves when you switch chats.",
 "The header’s Hide chat button, the message column, the composer and the terminal footnote all line up on one edge, as they do today.",
 "The wider the edge, the sooner long chat titles in the header truncate (“Empty cart…” becomes “Empty car…” at 16px)."
],questions:[
 {key:"edge",title:"",intro:"Four chat states per option, light and dark. Switch A/B/C and compare against the Today tab.",options:[
  {id:"A",name:"16px edges",why:"Every edge goes from 12px to 16px: header, messages, composer and footnote. It matches the left sidebar’s 16px and is the smallest change that loosens the frame. Message spacing stays at 16px.",cost:"Loses 8px of text width (429 → 421px at the default split). Rhythm between turns is unchanged, so a long chat still reads as tightly stacked.",state:"",shots:shotsFor("a","A")},
  {id:"B",name:"16px edges, more air between messages",why:"A’s 16px edges, plus 20px between messages (from 16) and your bubble padded 8px × 14px (from 6 × 12). The edges stop feeling cramped and each turn gets a little more separation, without changing what anything looks like.",cost:"Same width cost as A. A long chat is about 5% taller, so slightly less fits on screen.",rec:true,state:"",shots:shotsFor("b","B")},
  {id:"C",name:"Open column, 20px, no rules",why:"20px edges and B’s 20px rhythm, and the hairlines under the header and above the composer go, so the panel reads as one open column. The composer’s own box is the only edge left. This is the furthest from today, closer to Claude’s and ChatGPT’s chat columns.",cost:"Loses 16px of text width (429 → 413px). Without the rules, scrolled messages pass under the header and composer with nothing marking the edge; that likely needs a fade, which is a new pattern. Titles truncate soonest.",state:"",shots:shotsFor("c","C")}
 ]}
]}
];
