<style>
.wf{width:100%;max-width:448px;margin:0 auto;display:flex;flex-direction:column;gap:20px;font-family:var(--font-ui)}
.wf-cap{font-size:12px;color:var(--muted-foreground);text-align:center}
.wf-dlg{background:var(--background);color:var(--foreground);border:1px solid var(--border);box-shadow:0 8px 30px oklch(0 0 0 / 12%);padding:20px;display:flex;flex-direction:column;gap:20px;text-align:left}
.wf-h{display:flex;flex-direction:column;gap:6px}
.wf-t{font-family:var(--font-title);font-size:20px;line-height:1.25;letter-spacing:-.01em}
.wf-d{font-size:13px;line-height:1.45;color:var(--muted-foreground)}
.wf-f{display:flex;flex-direction:column;gap:8px}
.wf-l{font-family:var(--font-code);font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted-foreground)}
.wf-i{height:32px;box-sizing:border-box;border:1px solid var(--input);border-radius:0;padding:0 10px;display:flex;align-items:center;gap:8px;font-family:var(--font-code);font-size:13px;white-space:nowrap;overflow:hidden;min-width:0}
.wf-i.ui{font-family:var(--font-ui)}
.wf-i .m{color:var(--muted-foreground)}
.wf-i .chev{margin-left:auto;color:var(--muted-foreground);font-family:var(--font-ui)}
.wf-ta{height:64px;align-items:flex-start;padding-top:8px}
.wf-fd{font-size:13px;line-height:1.45;color:var(--muted-foreground)}
.wf-adv{font-size:13px;color:var(--muted-foreground);font-weight:500}
.wf-ft{display:flex;justify-content:flex-end;gap:8px;align-items:center}
.wf-b{height:32px;padding:0 12px;display:inline-flex;align-items:center;font-size:13px;font-weight:500}
.wf-b.p{background:var(--primary);color:var(--primary-foreground)}
.wf-menu{background:var(--foreground);color:var(--background);border-radius:8px;padding:4px;display:flex;flex-direction:column;box-shadow:0 8px 30px oklch(0 0 0 / 18%)}
.wf-mi{display:flex;align-items:baseline;gap:8px;padding:6px 8px;font-size:13px;border-radius:4px;white-space:nowrap;min-width:0}
.wf-mi.on{background:color-mix(in oklch,var(--background) 16%,transparent)}
.wf-mi .m{opacity:.6;font-size:12px;overflow:hidden;text-overflow:ellipsis}
.wf-mi .ck{width:16px;flex:none}
.wf-mi .r{margin-left:auto;opacity:.6;font-size:12px}
.wf-rows{display:flex;flex-direction:column;gap:8px}
.wf-row{border:1px solid var(--border);padding:10px 12px;display:flex;align-items:center;gap:10px}
.wf-row.on{border-color:var(--foreground)}
.wf-row .tx{display:flex;flex-direction:column;gap:2px;min-width:0}
.wf-row .n{font-size:13px;font-weight:500}
.wf-row .s{font-size:12px;color:var(--muted-foreground)}
.wf-row .r{margin-left:auto;font-size:12px;color:var(--muted-foreground);white-space:nowrap}
.wf-radio{width:14px;height:14px;border-radius:50%;border:1px solid var(--muted-foreground);flex:none;box-sizing:border-box}
.wf-radio.on{border:4px solid var(--foreground)}
.wf-cb{width:14px;height:14px;border:1px solid var(--muted-foreground);flex:none;box-sizing:border-box;display:grid;place-items:center;font-size:10px;line-height:1}
.wf-cb.on{background:var(--foreground);border-color:var(--foreground);color:var(--background)}
.wf-sec{border-top:1px solid var(--border);padding-top:16px;display:flex;flex-direction:column;gap:12px}
.wf-sh{display:flex;align-items:baseline;gap:8px;font-size:13px;font-weight:500}
.wf-sh .m{font-weight:400;font-size:12px;color:var(--muted-foreground)}
.wf-note{font-size:12px;color:var(--muted-foreground);text-align:center}
.pt-ref{max-width:370px;margin:8px auto 0}.pt-ref img{width:100%;display:block}.pt-ref .pt-d{display:none}.dark .pt-ref .pt-l{display:none}.dark .pt-ref .pt-d{display:block}
</style>
<script>
const IMG=(p,cap,dk)=>({p,cap,dk});
const PAGE={
 date:"6 October 2026",
 slug:"monorepo-app-picker",
 quote:"when we do the auto-detection for repo config, do we detect monorepos and offer a choice of which app to set the config for? … lets do design exploration and refine this so that it works well",
 q:"When a repository holds several apps, how does adding it let you choose which app the run settings are for?"
};
const APPS=[
 ["app","apps/app","Next.js"],["docs","apps/docs","Next.js"],["homepage","apps/homepage","Next.js"],["skill-templates","packages/skill-templates","Vite"]
];
const dlg=(title,desc,body,foot)=>`<div class="wf-dlg"><div class="wf-h"><div class="wf-t">${title}</div><div class="wf-d">${desc}</div></div>${body}<div class="wf-ft">${foot}</div></div>`;
const field=(l,inner,d,cls="")=>`<div class="wf-f"><div class="wf-l">${l}</div><div class="wf-i ${cls}">${inner}</div>${d?`<div class="wf-fd">${d}</div>`:""}</div>`;
const setup=field("Setup script","pnpm install","Runs once when a chat’s code is set up.");
const files=field("Files to copy",".env*","Files from your folder to copy into each chat’s code, like .env. One pattern per line.","wf-ta");
const adv=`<div class="wf-adv">› Advanced</div>`;
const btns=(back,go)=>`<span class="wf-b">${back}</span><span class="wf-b p">${go}</span>`;
const DESC="Confirm the run settings for zschiller/screenplay before it’s added.";

// A: App select at the top of Configure
const aField=field("App",`<span style="font-weight:500">app</span><span class="m">apps/app · Next.js</span><span class="chev">⌄</span>`,"Found 4 apps. A repository previews one; add it again for another.","ui");
const aMenu=`<div class="wf-menu">${APPS.map((a,i)=>`<div class="wf-mi${i==0?" on":""}"><span class="ck">${i==0?"✓":""}</span><span>${a[0]}</span><span class="m">${a[1]}</span><span class="r">${a[2]}</span></div>`).join("")}</div>`;
const A_HTML=`<div class="wf">${dlg("Configure repository",DESC,aField+field("Run script","turbo run dev --filter app","Starts the app your frames preview.")+setup+files+adv,btns("Back","Add repository"))}
<div class="wf-cap">The App menu open</div>${aMenu}</div>`;

// B: Choose an app step before Configure
const bRows=`<div class="wf-rows">${APPS.map((a,i)=>`<div class="wf-row${i==0?" on":""}"><span class="wf-radio${i==0?" on":""}"></span><span class="tx"><span class="n">${a[0]}</span><span class="s">${a[1]}</span></span><span class="r">${a[2]}</span></div>`).join("")}</div>`;
const B_HTML=`<div class="wf"><div class="wf-cap">Step 2 of 3, only for a repository with several apps</div>${dlg("Choose an app","zschiller/screenplay has 4 apps. A repository previews one; add it again for another.",bRows,btns("Back","Continue"))}
<div class="wf-cap">Step 3: Configure, filled for the chosen app</div>${dlg("Configure repository","Confirm the run settings for app in zschiller/screenplay before it’s added.",setup+field("Run script","turbo run dev --filter app","Starts the app your frames preview.")+files+adv,btns("Back","Add repository"))}</div>`;

// C: add several apps at once
const cRows=`<div class="wf-rows">${APPS.map((a,i)=>`<div class="wf-row${i<2?" on":""}"><span class="wf-cb${i<2?" on":""}">${i<2?"✓":""}</span><span class="tx"><span class="n">${a[0]}</span><span class="s">${a[1]}</span></span><span class="r">${a[2]}</span></div>`).join("")}</div>`;
const cSec=(n,p)=>`<div class="wf-sec"><div class="wf-sh">${n}<span class="m">${p}</span></div>${field("Run script",`turbo run dev --filter ${n}`)}</div>`;
const C_HTML=`<div class="wf"><div class="wf-cap">Step 2 of 3, only for a repository with several apps</div>${dlg("Choose apps","zschiller/screenplay has 4 apps. Each one you pick becomes its own repository.",cRows,btns("Back","Continue"))}
<div class="wf-cap">Step 3: one section per app, shared setup on top</div>${dlg("Configure 2 repositories",DESC.replace("before it’s added","before they’re added"),setup+files+cSec("app","apps/app")+cSec("docs","apps/docs"),btns("Back","Add 2 repositories"))}</div>`;

const TODAY={facts:[
 "Run on this very repository, detection found 4 apps: <code>apps/app</code>, <code>apps/docs</code> and <code>apps/homepage</code> (Next.js) and <code>packages/skill-templates</code> (Vite). It filled <code>turbo run dev --filter @workspace/skill-templates</code> on port 5173: the template builder, not the product.",
 "Why: the rule-based pass keeps the root entry, or else the first package it found (<code>lib/add-repo/detect-settings.ts:76</code>). Choosing a package was left for “a later slice” (<code>detect-settings.ts:70</code>).",
 "The model pass reads up to 8 <code>package.json</code> files under <code>apps/</code>, <code>packages/</code>, <code>services/</code> and <code>web/</code>, and is told to target “the user-facing web app” (<code>model-detect.ts:26</code>, <code>:88</code>, <code>:163</code>). It returns one command; the dialog never says it chose, or among what.",
 "The dialog is 448px wide with 32px inputs and 12px mono labels. Desktop folder picks show Setup script, Run script and Files to copy; hosted adds Preview port and env vars. Advanced holds frame size, Agent instructions and Name.",
 "Name is how one repository becomes two (“web” and “api”), keyed by repository and name (<code>lib/add-repo/resolver.ts:17</code>). It sits last under Advanced, below the fold once Advanced opens (749px dialog).",
 "The docs tell people to add the repository again per app, with a filtered run script and a name (<code>guides/repositories.mdx:189</code>)."
],shots:[IMG("today/mono-today-light.png","Today · Configure for zschiller/screenplay","today/mono-today-dark.png"),IMG("today/mono-today-advanced-light.png","Today · Advanced open","today/mono-today-advanced-dark.png")]};

const R2_PATHS_B=`<b>Paths</b><br>1. One-app repository: the row shows “Finding apps…” for about a second, then Configure opens as today.<br>2. zschiller/screenplay: Finding apps… → Choose an app (app preselected, marked Suggested) → Continue → Configure, filled for app, with Name “app” and Agent instructions under Advanced → Add repository → Canvas settings lists “zschiller/screenplay app”.<br>3. Back on Configure returns to Choose an app with your choice kept; Back there returns to the list. Escape steps back the same way.<br>4. Adding it again: app shows Added and can’t be picked; docs is suggested.<br>5. Finding apps fails or runs past ~8s: Configure opens with today’s “Couldn’t auto-detect settings” and Re-detect.`;
const R2_PATHS_A=`<b>Paths</b><br>1. Any repository: Configure opens at once with “Detecting settings…”.<br>2. zschiller/screenplay: after about a second the App field appears at the top, set to app, and the fields fill.<br>3. Switching app in the field re-fills the run script, Name and Agent instructions you haven’t typed in.<br>4. Adding it again: app shows Added in the menu; docs is preselected.`;
const ROUNDS=[
{n:6,feedback:"“A3a is good but not consistent visually w/ our other searchable pickers. look at those (e.g. chat picker) and match that.” “usually they are not inverted”",every:[
 "The list now uses the chat picker’s measured styling: popover surface (white, or lifted near-black in dark), 1px hairline ring, 2px corners, 4px padding.",
 "Search field as in the chat picker: 32px, faint fill, magnifier, “Search apps…”. Group headings in 12px mono caps, rows 32px with a 16px leading icon, 13px name, muted bg on hover and on the chosen app.",
 "Apps are grouped by their top folder (APPS, PACKAGES), the way chats group by state. Each row shows the folder in 12px mono and the framework at the end; the chosen app adds a check, Added apps are dimmed.",
 "The trigger is round 5’s A3a row, unchanged. The list matches the row’s width, like shadcn’s Combobox."
],questions:[
 {key:"match",title:"",intro:"Pick zschiller/screenplay, then open the row. Type to filter; groups with no match hide.",options:[
  {id:"A3a",name:"Matched to the chat picker",why:"A3a with the list restyled to the chat picker, so every searchable picker in the app looks the same. The chat picker as it ships today is below the prototype for comparison.",cost:"",state:"",html:'<div data-proto="R6"></div><div class="wf-cap" style="margin-top:20px">Today’s chat picker, for comparison</div><div class="pt-ref"><img src="r6/chats-light.png" alt="Chat picker, light" class="pt-l"><img src="r6/chats-dark.png" alt="Chat picker, dark" class="pt-d"></div>'}
 ]}
]},
{n:5,feedback:"“A1, but the menu opening like from a \"Change\" button that is a bit odd. A3 is closer maybe but refine both directions”",every:[
 "A1’s row everywhere: folder square, app name over folder · framework, the inputs’ border, 52px tall. Same placeholders-then-form detection as rounds 3 and 4.",
 "A1a and A1b keep the Change button and fix what it opens. A3a and A3b make the whole row the control and fix what makes it read as a plain Select.",
 "Every list shows folder and framework, with Added on apps you already have."
],questions:[
 {key:"open",title:"What the app row opens",intro:"Pick zschiller/screenplay, then open the app list from the row.",options:[
  {id:"A1a",name:"Menu from Change",why:"Change opens a dropdown anchored to the button itself, right-aligned and sized to its widest item (224px minimum), the way our ⋯ menus open from their trigger. No full-width sheet dropping from a small button.",cost:"Still two clicks; on a narrow phone the menu nearly fills the width anyway.",state:"",html:'<div data-proto="R5A"></div>'},
  {id:"A1b",name:"Change opens the list in place",why:"Change turns the row into round 3’s C list right there (40px radio rows); choosing an app collapses it back to the row. No floating menu at all, so nothing looks detached from its button.",cost:"The form grows by about 110px while the list is open, pushing the fields down until you choose.",state:"",html:'<div data-proto="R5B"></div>'},
  {id:"A3a",name:"Searchable picker",state:"picked",why:"The whole row is the button with an up-down chevron, shadcn’s Combobox pattern (Popover + Command). The list opens full width under the row with a search field, which also covers repositories with many apps.",cost:"Search is overkill for 2–4 apps; still reads a little like a field.",rec:true,html:'<div data-proto="R5C"></div>'},
  {id:"A3b",name:"Row says Change",why:"The whole row is the button, but it ends in a visible “Change” label with a down chevron instead of a bare chevron, and the border darkens on hover. A3’s big target with A1’s explicit word.",cost:"“Change” as label text inside a button is a new pattern next to our stock Select.",state:"",html:'<div data-proto="R5D"></div>'}
 ]}
]},
{n:4,feedback:"“can we refine the styling of A but also keep C as an option”",every:[
 "Same flow as round 3: Configure opens at once, placeholders for about a second, then the whole form; the description names the app; a one-app repository shows no App control.",
 "The A rows use shadcn’s Item layout: a 36px square with the folder icon, the app name (13px medium) over its folder and framework (12px muted), at the field’s full 408px width and 52px tall.",
 "Change opens the same list as the Select menus: inverted surface, check on the chosen app, folder and framework on each row, Added for apps you already have.",
 "C is round 3’s list, unchanged, so you can compare it with the refined rows."
],questions:[
 {key:"style",title:"Styling the app row",intro:"Pick zschiller/screenplay; Change (or the row in A3) opens the list.",options:[
  {id:"A1",name:"Outlined row",state:"picked",why:"The row takes the inputs’ 1px border and the folder square, with an outline Change button at the right. It reads as a field that already has an answer, taller than the inputs so it stands out without new colour.",cost:"Two clicks to switch app.",rec:true,html:'<div data-proto="R4A"></div>'},
  {id:"A2",name:"Filled row",why:"A muted fill instead of a border, the icon square cut out in the background colour, and a ghost Change button. The only filled block in the form, so it’s the first thing you see.",cost:"A filled block is a new look next to outlined inputs; in dark mode the fill is subtle.",state:"",html:'<div data-proto="R4B"></div>'},
  {id:"A3",name:"Row as picker",why:"The whole outlined row is the button, with a chevron like a Select. One big target instead of a small Change button.",cost:"Looks like a tall Select, so it may read as just another field, the thing you said made A easy to overlook.",state:"",html:'<div data-proto="R4C"></div>'},
  {id:"C",name:"App list in the form",why:"Round 3’s C, kept: every app as a compact radio row at the top of Configure, one click to switch.",cost:"About 130px taller for 4 apps; past six apps the list needs to scroll.",state:"",html:'<div data-proto="R3C"></div>'}
 ]}
]},
{n:3,feedback:"“i guess A with a nicer more prominent affordance is basically what you're describing? and should we just have a quick delay to detect where the other fields are below? yea do another pass” (after Vercel’s Root Directory + Edit was shared as a reference)",every:[
 "Configure opens as soon as you pick the repository. While the rule-based pass runs (about a second) the fields show as placeholders, then the whole form appears at once, so nothing slides down under your cursor.",
 "For a repository with several apps, the App control is the first thing in the form and the description names the app (“Confirm the run settings for app in zschiller/screenplay…”). Changing app re-fills the run script, Name and Agent instructions you haven’t typed in.",
 "A one-app repository shows no App control. The model pass then refines the chosen app’s settings in place, with today’s “Detecting settings…” line.",
 "Apps you’ve already added show as Added and can’t be picked; the first one not yet added is preselected. Vercel’s import has the same shape: Root Directory with Edit in the config form, one project per app, import again for the next (vercel.com/docs/monorepos)."
],questions:[
 {key:"control",title:"How the app shows in Configure",intro:"Pick zschiller/screenplay to see the control; acme/storefront shows a one-app repository.",options:[
  {id:"A",name:"App row with Change",state:"picked",why:"A bordered summary of the chosen app (name, folder, framework) with a Change button, like Vercel’s Root Directory with Edit. Change opens the list of apps over the form. The border and the button make it read as a choice that was made for you, not one more text field.",cost:"Switching takes two clicks. The list is a popover, a small new pattern next to the existing Select.",rec:true,html:'<div data-proto="R3A"></div>'},
  {id:"B",name:"App chips",why:"Every app is a one-click toggle in a row above the fields, the folder and framework of the chosen one under it. You see all the apps without opening anything.",cost:"Wraps to more lines past about six apps, and long package names get wide. Shows names only, so two apps called web in different folders are ambiguous.",state:"",html:'<div data-proto="R3B"></div>'},
  {id:"C",name:"App list in the form",why:"All apps as a compact radio list at the top of Configure: name, folder and framework on each 32px row. The most visible of the three, and it is B’s step folded into the form.",cost:"Adds a row per app (about 130px for 4 apps), pushing the fields down; past six apps it would need to scroll inside the list.",state:"",html:'<div data-proto="R3C"></div>'}
 ]}
]},
{n:2,feedback:"“i kinda like B? A feels easy to overlook? also can we prototype this end to end, what is the flow like for either when picking a repo => detected its a monorepo”",every:[
 "Both flows start in Canvas settings with one repository already on (acme/web). Click New repository, then pick zschiller/screenplay (4 apps) or a one-app repository such as acme/storefront.",
 "The rule-based pass lists the apps in about a second over the GitHub API. The model pass is too slow to wait on (up to 30s), so it runs after you choose, refining settings for that app only.",
 "Suggested is the first app not already added, apps/ before packages/. On this repo that’s app, then docs.",
 "Choosing an app fills its run script, and under Advanced its Name and Agent instructions, only in fields you haven’t typed in. The canvas row shows the name after the repository, as today."
],questions:[
 {key:"flow",title:"Picking a repository that holds several apps",intro:"Click through each flow. The line above the dialog records the path you took.",options:[
  {id:"B",name:"Choose an app first",why:"A step you can’t miss: picking a monorepo stops on a list of its apps before any settings show. Configure then names the app in its description.<br><br>"+R2_PATHS_B,cost:"Every pick, one-app repositories included, waits about a second on the list while apps are found. If Re-detect later finds several apps, it can’t send you back to the step; it fills Configure with the suggested app.",rec:true,state:"",html:'<div data-proto="B"></div>'},
  {id:"A",name:"App field",state:"picked",why:"Configure opens at once and the App field appears when detection finds several apps; you can switch apps without leaving the form.<br><br>"+R2_PATHS_A,cost:"Easy to overlook, as you said: it looks like any other field. The form jumps down about 76px when the field appears.",html:'<div data-proto="A"></div>'}
 ]}
]},
{n:1,feedback:"",every:[
 "Only a repository with 2 or more apps changes; a single-app repository keeps today’s dialog.",
 "Detection lists every app (path and framework) and preselects its best guess: the model ranks them, and the rules prefer <code>apps/</code> over <code>packages/</code> when there’s no model.",
 "Choosing an app fills its run script (<code>turbo run dev --filter app</code>) and port, sets Name to the app’s name and Agent instructions to “Work in the app under apps/app.”, only in fields you haven’t typed in.",
 "The word is “app”. Wireframes use the dialog’s real sizes and labels."
],questions:[
 {key:"where",title:"",intro:"Where the choice of app lives.",options:[
  {id:"A",name:"App field",why:"A new first field in Configure: a select listing the detected apps with path and framework, set to detection’s guess. You see what was chosen and among what, and switching re-fills the run script in place. No new step, and the add flow stays one repository per pass.",cost:"One new field; Configure grows by one row (about 76px) in monorepos. A second app still means adding the repository again.",rec:true,state:"",html:A_HTML},
  {id:"B",name:"Choose an app first",state:"picked",why:"A step between picking the repository and Configure, shown only for monorepos: one row per app, the guess preselected. Configure then opens already filled for that app and names it in its description.",cost:"An extra screen and click every time you add a monorepo. Changing your mind means going Back.",html:B_HTML},
  {id:"C",name:"Add several apps at once",why:"The same step with checkboxes. Each checked app becomes its own repository, named after the app, with one shared setup script and a run script per app. Replaces the docs’ “add it again” workaround with one pass.",cost:"The biggest change: Configure becomes a multi-section form, and the add flow returns several repositories (a canvas switches each on). Per-app advanced settings need their own sections.",state:"",html:C_HTML}
 ]}
]}
];
</script>
