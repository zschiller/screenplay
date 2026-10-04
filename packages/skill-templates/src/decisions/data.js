const IMG=(p,cap,dk)=>({p,cap,dk}); // p: light (or only) capture, dk: optional dark capture
const PAGE={
 label:"{{SURFACES}}", // the surfaces decided on, e.g. "Site, docs and app"
 date:"{{DATE}}",
 title:"{{H1}}",
 plans:"{{PLANS}}", // e.g. "site, docs and app audit plans": the lede says "questions from the …", the copied text "Decisions on the …"
 links:[["{{Surface}} plan","{{PLAN_URL}}"]], // one per source plan
 slug:"{{SLUG}}" // localStorage key, unique per page
};
// One entry per surface; the bar's jump links come from these. Question ids: surface letter + number. o[0] is always the recommendation.
// img: captures of exactly the thing decided; omit when none shows it.
const SURFACES=[
{key:"site",name:"Site",plan:"{{PLAN_URL}}",intro:"8 proposed PRs. PR 1 and PR 2 start without any of these.",qs:[
{id:"H1",where:"P1 · PR 4",t:"Should the figures sell versions of one change, or parallel tasks?",c:"One or two sentences of context: what's at stake and what the audits disagree on.",
 o:[["Versions","One-line consequence."],["Parallel tasks","One-line consequence."]],
 img:[IMG("site/fig1.now.png","Now · Fig. 1"),IMG("site/fig1.mockup.light.png","Mockup · Fig. 1","site/fig1.mockup.dark.png")]}
]}
];
// Every PR per surface: [number, title, "" | "waits on H1, H3" | short note]. "" renders as "runs regardless".
const RUNS={
site:[[1,"Correct the claims that aren't true",""],[4,"Redraw the figures around one ask","waits on H1"]]
};
