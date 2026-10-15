<script>
const IMG=(p,cap,dk)=>({p,cap,dk}); // p: light (or only) capture, dk: optional dark capture
const D=(o,cap)=>IMG(`r2/${o}-desk-light.webp`,cap,`r2/${o}-desk-dark.webp`);
const P=(o,cap)=>IMG(`r2/${o}-phone-light.webp`,cap);
const R1=(o,cap)=>IMG(`r1/exploration-${o}-desk-light.webp`,cap,`r1/exploration-${o}-desk-dark.webp`);
const PAGE={
 date:"5 Oct 2026",
 slug:"exploration-page-ux",
 quote:"ok 1659 landed but i still want to do a deep ux exploration on each of these to improve the intertactions, usability and visual hierarchy.",
 q:"How should the exploration page get you from reading an option to picking one?"
};
const TODAY={facts:[
 "Shown with the live tag exploration’s real data (3 rounds, round 3 open again) at a Mockup’s default 1280×800 (<code>apps/app/lib/constants.ts:5</code>) and on a 390px phone. Every capture on this page is a real build of <code>packages/skill-templates</code> with a scratch switch.",
 "<b>Pick</b> is the last thing in an option, at y 847 on the Mockup (951 on a phone), under the bottom bar’s 53px. You can switch letters without scrolling but never pick without it.",
 "<b>The question</b> only lives in the top bar, cut off at “What should a live frame’s title line show, and how …” (and “…titl…” on a phone). The full sentence appears nowhere on a round tab.",
 "<b>Before the letters</b>: the meta line, your first message (the same on every round tab), “Round 3 · open”, and a folded “Your feedback”. So the reason this round exists is one tap away, while the message that started round 1 is always open. The letters start at y 280.",
 "<b>The letters</b> are an 832px wide, 46px tall segmented control holding one letter each. You can’t tell what B is until you switch, and the letter repeats in the heading under it. Recommended takes its own 32px row under the name.",
 "<b>Keys</b>: ← and → do nothing here, though the storybook page steps states with them (<code>storybook.tsx:185</code>)."
],shots:[D("today","Today · Mockup 1280×800"),P("today","Today · phone")]};
const ROUNDS=[
{n:2,feedback:"Zack: “fhe skill template thing is too mcuh to do all3 together”. This page now covers the exploration page alone. Round 1’s Pick question is still open, so it comes first, with one new option (B).",every:[
 "Each question changes only its own part; the other two parts stay as Today, so you can compare one thing at a time.",
 "Same data and size as Today: the live tag exploration, round 3, at 1280×800 in both themes and on a phone.",
 "Stays inside the shared kit (PR #1659): pink only for Recommended, no “Asked in chat” labels, the page never scrolls on its own, and nothing from the rejected template revisions (Pick in the letters row, “A: name” headers, a reason line under Recommended)."
],questions:[
 {key:"pick",title:"Where Pick sits",intro:"Carried over from round 1. A and C are round 1’s A and B; B is new.",options:[
  {id:"A",name:"Beside the name",rec:true,why:"Pick moves to the right end of the option’s name row, above its captures: y 283 on the Mockup, 351 on a phone. Switching letters keeps it in the same spot, so you can read A, B and C and pick without scrolling. Captures, why and cost keep today’s order.",cost:"You can pick before reading the reasons. On a phone the 36px button makes the name row 10px taller.",shots:[D("pa","A · Mockup"),P("pa","A · phone")]},
  {id:"B",name:"In the bottom bar",why:"The bar always offers “Pick A” for the option you’re looking at, between the status and Note, so Pick is on screen wherever you are in a long option, at the thumb’s end of a phone. The option itself ends after its cost.",cost:"With several questions in a round the bar has to follow the question you’re reading, which is easy to get wrong. Three buttons in the bar leave the status about 120px on a phone.",shots:[D("pb","B · Mockup"),P("pb","B · phone")]},
  {id:"C",name:"Reasons first",why:"Why and cost come straight under the name, then Pick, then the captures: y 433 on the Mockup, 541 on a phone. You read the argument, pick, and check the captures.",cost:"Captures start about 130px lower, and a why that says “the capture” comes before it.",shots:[D("pc","C · Mockup"),P("pc","C · phone")]}
 ]},
 {key:"head",title:"How options are named and switched",intro:"Today the letters say nothing about the option behind them, and the name and Recommended stack under them.",options:[
  {id:"A",name:"Names in the letters",why:"Each segment shows its letter and the option’s name, so you see all three answers before switching. The heading under it drops the repeated letter.",cost:"At 1280 each segment has 277px, enough for most names. On a phone it has 119px, so names cut to “Faded h…”. A longer control on a sticky row.",shots:[D("ha","A · Mockup"),P("ha","A · phone")]},
  {id:"B",name:"Compact letters",rec:true,why:"The letters shrink to fit (270px instead of 832), so they read as a switch rather than a header, and Recommended joins the name’s row. Options start 32px higher and the name is the strongest thing under the letters.",cost:"Names still only show after switching. A smaller target on a phone (56px a letter instead of 119).",shots:[D("hb","B · Mockup"),P("hb","B · phone")]},
  {id:"C",name:"Step through, like the storybook",why:"No letters: the option’s letter, name and Recommended become the sticky row, with “1 of 3” and the storybook’s ‹ › buttons, and ← → step options. One pattern for stepping on both pages, and options start 64px higher.",cost:"No jumping straight to C, and the letters’ dots for Recommended and your pick go, so the bar is the only place your pick shows. The rejected “Pick in the letters row” would come back if Pick moved here, so it can’t.",shots:[D("hc","C · Mockup"),P("hc","C · phone")]}
 ]},
 {key:"open",title:"What opens a round",intro:"Everything between the top bar and the letters.",options:[
  {id:"A",name:"The round’s feedback",rec:true,why:"A round tab opens on “Round 3 · open” and the feedback that started it, as the quote, up to 3 lines. Your first message moves to Round 1, where it started things, and to Today. “In every option” stays folded. The letters move up to y 236.",cost:"Your original words are no longer on the open round; on round 4 of a long exploration they’re two tabs away.",shots:[D("oa","A · Mockup"),P("oa","A · phone")]},
  {id:"B",name:"The question in full",why:"The question opens the page as a 20px heading over the meta and quote, wrapping instead of cutting off, and the top bar’s title only fades in once it scrolls under the bar. The second capture is scrolled.",cost:"Options start 116px lower than today (letters at y 370). The top bar changes for one page, which the shared kit doesn’t do yet.",shots:[D("ob","B · Mockup"),D("ob-scrolled","B · Mockup, scrolled"),P("ob","B · phone")]},
  {id:"C",name:"Straight to the options",why:"Nothing but one fold, “What started round 3”, holding the meta, the feedback and what every option shares. The letters sit at y 141, the capture at 235, so a Mockup shows most of an option on its first screen.",cost:"Nothing tells you why the round exists until you open the fold, and on a first visit you land on options without context.",shots:[D("oc","C · Mockup"),P("oc","C · phone")]}
 ]}
]},
{n:1,feedback:"Round 1 asked about all four skill pages at once on <a href=\"https://claude.ai/artifact/JuDNbVMiryR8doHRRDg4aT\">Skill page interactions</a>. This is its exploration question; the other pages moved to their own threads.",questions:[
 {key:"pick",title:"Reaching Pick on an exploration",intro:"Pick sat below a 1280×800 Mockup’s first screen. Carried over to round 2 with no pick.",options:[
  {id:"A",name:"Pick beside the name",rec:true,why:"Pick moves to the right end of the option’s name, before its captures.",cost:"Pick comes before the reasons.",shots:[R1("a","A · Exploration")]},
  {id:"B",name:"Reasons first",why:"Why and cost come straight under the name, then Pick, then the captures.",cost:"Captures start lower.",shots:[R1("b","B · Exploration")]},
  {id:"C",name:"Captures fit the screen",why:"Captures are capped so the whole option fits the first screen.",cost:"Captures shrink to about 280px tall. Not carried into round 2: it shrinks the reason to open the page.",shots:[R1("c","C · Exploration")]}
 ]}
]}
];
</script>
