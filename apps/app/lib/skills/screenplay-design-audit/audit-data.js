// The audit page's data: data.js in the Mockup's folder, which its index.html loads. Every capture path it names loads from the Mockup's folder, relative to index.html, so write each capture there at that path.
const IMG=(p,cap,dk)=>({p,cap,dk}); // p: light (or only) capture, dk: optional dark capture
const PAGE={
 title:"{{SURFACE}} design audit",
 date:"{{DATE}}",
 slug:"{{SLUG}}", // localStorage key, unique per audit
 lede:["What was audited (surface, commit, depths) and what was focused on.","How to answer: pick Fix or Skip on each finding, answer each call and add notes, then copy your picks (or send them, on a canvas) back to the chat. Anything left unpicked keeps the recommendation."],
 links:[["Prototype patch","{{PATCH}}"]] // optional
};
// Depth letters match the finding ids. blurb: one line on what the depth checks.
const DEPTHS=[{key:"P",name:"Product",blurb:"Is every claim true, and what is a real user missing."},{key:"H",name:"Interaction",blurb:"What people see first, what they can reach, and where flows dead-end."},{key:"N",name:"Visual nits",blurb:"Spacing, type, colour and component drift against the rules."}];
// Optional: work in flight that may change findings. Each finding it touches carries pend.
const NOTICES=[{title:"Pending the X exploration",body:"What is changing, in one or two sentences."}];
// sev: "high" | "med" | "low". wrong, fix and box text may hold inline HTML. evidence: file:line strings, rendered as code.
// call: a question only the owner can answer, with 2-3 options, rec on one. pend: {tag, why} when a NOTICE may change it.
// still: "Still open from <earlier audit id>". related: other finding ids.
const FINDINGS=[
 {id:"P1",sev:"high",title:"One-line title in product words",wrong:"What is wrong, from the user's side.",evidence:["path/to/file.tsx:12-20"],fix:"The smallest fix inside the current UX.",shots:[IMG("img/p1-now-light.webp","Now","img/p1-now-dark.webp")]},
 {id:"H1",sev:"med",title:"A finding that needs the owner",wrong:"What is wrong.",evidence:["path/to/file.tsx:40"],fix:"Depends on the call.",call:{q:"The question in one line?",options:[{id:"A",label:"Option A",rec:true},{id:"B",label:"Option B"}]},pend:{tag:"May change",why:"How the in-flight work changes this finding."}},
 {id:"N1",sev:"low",title:"A visual nit with a built fix",wrong:"What is off, with the measurement.",evidence:["path/to/file.tsx:9"],fix:"The class change. Patched.",shots:[IMG("img/n1-now-light.webp","Now","img/n1-now-dark.webp"),IMG("img/n1-after-light.webp","After","img/n1-after-dark.webp")]}
];
// Closing folds: checked and fine, merged findings, dropped findings, method. Items may hold inline HTML.
const EXTRA=[["Checked and fine",["Something checked that holds."]],["How this was checked",["Method per depth."]]];
