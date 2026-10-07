// The exploration page's data: data.js in the Mockup's folder, which its index.html loads. Every capture path it names loads from the Mockup's folder, relative to index.html, so write each capture there at that path.
const IMG=(p,cap,dk)=>({p,cap,dk}); // p: light (or only) capture, dk: optional dark capture
const PAGE={
 date:"{{DATE}}",
 slug:"{{SLUG}}", // localStorage key, unique per exploration
 quote:"The owner's own words that started this exploration.",
 q:"The question in one line?"
};
// Today: the Today tab. facts are short lines with the measured numbers; shots follow them, then html (an optional drawn wireframe).
const TODAY={facts:["What main does now, with the measured numbers that matter."],shots:[IMG("today/home-light.png","Today · Home","today/home-dark.png")]};
// Newest round first in this list; the tabs show rounds in time order and open on this first one. A round's questions each show one option at a time behind A/B/C tabs.
// A question with one option is a sign-off (Looks good / Needs changes).
// option: id, name, why, cost, rec, state ("" | "picked" | "rejected"), shots and/or html. why, cost, facts, every and feedback may hold inline HTML.
// every: what all of the round's options share, folded above the questions. feedback: the owner's reaction that started the round, three lines until opened.
const ROUNDS=[
{n:2,feedback:"What the owner said about round 1.",every:["Something every option in this round shares."],questions:[
 {key:"look",title:"The first question",intro:"What the options in this question have in common.",options:[
  {id:"A",name:"Short name",why:"Two or three sentences on why this answers the question.",cost:"What it costs or breaks.",rec:true,state:"",shots:[IMG("r2/a-light.png","A · Home","r2/a-dark.png")]},
  {id:"B",name:"Short name",why:"Why.",cost:"Cost.",state:"",shots:[IMG("r2/b-light.png","B · Home","r2/b-dark.png")]}
 ]},
 {key:"final",title:"Everything so far",intro:"One option, so this question is a sign-off.",options:[
  {id:"P",name:"Combined",why:"The picks together.",cost:"",state:"",shots:[IMG("r2/p-light.png","P · Home","r2/p-dark.png")]}
 ]}
]},
{n:1,feedback:"",questions:[
 {key:"pick",title:"",intro:"",options:[
  {id:"A",name:"Short name",why:"Why.",cost:"Cost.",rec:true,state:"rejected",shots:[]},
  {id:"B",name:"Short name",why:"Why.",cost:"Cost.",state:"picked",shots:[]}
 ]}
]}
];
