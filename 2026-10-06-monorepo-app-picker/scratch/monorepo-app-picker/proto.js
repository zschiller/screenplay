<style>
.pt{width:100%;max-width:448px;margin:0 auto;display:flex;flex-direction:column;gap:12px;font-family:var(--font-ui);text-align:left}
.pt-stage{min-height:620px;display:flex;flex-direction:column;justify-content:flex-start}
.pt .wf-dlg{gap:16px}
.pt-x{margin-left:auto;color:var(--muted-foreground);font-size:16px;line-height:1}
.pt-hd{display:flex;align-items:flex-start;gap:8px}
.pt-search{height:32px;background:var(--muted);display:flex;align-items:center;gap:8px;padding:0 10px;font-size:13px;color:var(--muted-foreground)}
.pt-list{display:flex;flex-direction:column}
.pt-repo{all:unset;box-sizing:border-box;cursor:pointer;height:32px;padding:0 8px;display:flex;align-items:center;gap:8px;font-size:13px;color:var(--foreground)}
.pt-repo:hover,.pt-repo:focus-visible{background:var(--muted)}
.pt-repo .r{margin-left:auto;font-size:12px;color:var(--muted-foreground);display:flex;align-items:center;gap:6px}
.pt-ico{width:16px;height:16px;flex:none;color:var(--muted-foreground)}
.pt-spin{width:12px;height:12px;border:1.5px solid var(--muted-foreground);border-top-color:transparent;border-radius:50%;animation:ptspin .8s linear infinite;flex:none}
@keyframes ptspin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.pt-spin{animation:none}}
.pt-status{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted-foreground);min-height:20px}
.pt-pick{all:unset;box-sizing:border-box;cursor:pointer;border:1px solid var(--border);padding:10px 12px;display:flex;align-items:center;gap:10px;width:100%}
.pt-pick[aria-checked=true]{border-color:var(--foreground)}
.pt-pick[aria-disabled=true]{cursor:default;opacity:.55}
.pt-pick:focus-visible{outline:2px solid var(--ring);outline-offset:1px}
.pt-pick .tx{display:flex;flex-direction:column;gap:2px;min-width:0}
.pt-pick .n{font-size:13px;font-weight:500;display:flex;gap:6px;align-items:baseline}
.pt-pick .n .tag{font-weight:400;font-size:12px;color:var(--muted-foreground)}
.pt-pick .s{font-size:12px;color:var(--muted-foreground)}
.pt-pick .r{margin-left:auto;font-size:12px;color:var(--muted-foreground);white-space:nowrap}
.pt-btn{all:unset;box-sizing:border-box;cursor:pointer;height:32px;padding:0 12px;display:inline-flex;align-items:center;font-size:13px;font-weight:500;color:var(--foreground)}
.pt-btn.p{background:var(--primary);color:var(--primary-foreground)}
.pt-btn.o{border:1px solid var(--border);height:28px;padding:0 10px;font-size:13px}
.pt-btn:focus-visible,.pt-sel:focus-visible,.pt-adv:focus-visible,.pt-repo:focus-visible{outline:2px solid var(--ring);outline-offset:1px}
.pt-sel{all:unset;box-sizing:border-box;cursor:pointer;height:32px;border:1px solid var(--input);padding:0 10px;display:flex;align-items:center;gap:8px;font-size:13px;width:100%}
.pt-sel .m{color:var(--muted-foreground)}
.pt-sel .chev{margin-left:auto;color:var(--muted-foreground)}
.pt-selwrap{position:relative}.pt-selwrap .pt-menu{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:5}
.pt-menu{background:var(--foreground);color:var(--background);padding:4px;display:flex;flex-direction:column;box-shadow:0 8px 30px oklch(0 0 0 / 18%);border-radius:8px}
.pt-mi{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:baseline;gap:8px;padding:6px 8px;font-size:13px;border-radius:4px;white-space:nowrap}
.pt-mi:hover,.pt-mi:focus-visible{background:color-mix(in oklch,var(--background) 16%,transparent)}
.pt-mi[aria-disabled=true]{opacity:.5;cursor:default}
.pt-mi .ck{width:14px;flex:none}
.pt-mi .m{opacity:.6;font-size:12px}
.pt-mi .r{margin-left:auto;opacity:.6;font-size:12px}
.pt-adv{all:unset;cursor:pointer;font-size:13px;font-weight:500;color:var(--muted-foreground);align-self:flex-start}
.pt-new{animation:ptnew 1.6s ease-out}
@keyframes ptnew{from{background:var(--muted)}to{background:transparent}}
@media (prefers-reduced-motion:reduce){.pt-new{animation:none}}
.pt-row{display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid var(--border);font-size:13px}
.pt-row .lab{color:var(--muted-foreground)}
.pt-row .r{margin-left:auto;font-size:12px;color:var(--muted-foreground)}
.pt-sec{font-family:var(--font-code);font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted-foreground)}
.pt-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;font-size:12px;color:var(--muted-foreground)}
.pt-trail{line-height:1.6;font-size:12px;color:var(--muted-foreground)}
.pt-trail b{font-weight:500;color:var(--foreground)}
.pt-hint{font-size:12px;color:var(--muted-foreground);text-align:center}
.pt-app{border:1px solid var(--foreground);padding:10px 12px;display:flex;align-items:center;gap:10px}
.pt-app .tx{display:flex;flex-direction:column;gap:2px;min-width:0}.pt-app .n{font-size:13px;font-weight:500}.pt-app .s{font-size:12px;color:var(--muted-foreground)}.pt-app .pt-btn{margin-left:auto}
.pt-pop{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:5;background:var(--background);border:1px solid var(--border);box-shadow:0 8px 30px oklch(0 0 0 / 14%);padding:6px;display:flex;flex-direction:column;gap:4px}
.pt-pick.sm{padding:8px 10px;border-color:transparent}.pt-pick.sm[aria-checked=true]{border-color:var(--foreground)}
.pt-chips{display:flex;flex-wrap:wrap;gap:6px}
.pt-chip{all:unset;box-sizing:border-box;cursor:pointer;height:28px;padding:0 10px;border:1px solid var(--border);font-size:13px;display:inline-flex;align-items:center}
.pt-chip[aria-checked=true]{background:var(--foreground);color:var(--background);border-color:var(--foreground);font-weight:500}
.pt-chip[aria-disabled=true]{opacity:.45;cursor:default}
.pt-ilist{border:1px solid var(--input);display:flex;flex-direction:column}
.pt-irow{all:unset;box-sizing:border-box;cursor:pointer;height:32px;padding:0 10px;display:flex;align-items:center;gap:8px;font-size:13px;min-width:0}
.pt-irow+.pt-irow{border-top:1px solid var(--border)}
.pt-irow[aria-checked=true]{background:var(--muted)}.pt-irow[aria-checked=true] .n{font-weight:500}
.pt-irow[aria-disabled=true]{opacity:.5;cursor:default}
.pt-irow .s{font-size:12px;color:var(--muted-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.pt-irow .r{margin-left:auto;font-size:12px;color:var(--muted-foreground);white-space:nowrap}
.pt-chip:focus-visible,.pt-irow:focus-visible,.pt-pick:focus-visible{outline:2px solid var(--ring);outline-offset:1px}
.pt-sk{background:var(--muted);animation:ptsk 1.2s ease-in-out infinite alternate}
@keyframes ptsk{to{opacity:.5}}@media (prefers-reduced-motion:reduce){.pt-sk{animation:none}}
.pt-item{box-sizing:border-box;width:100%;display:flex;align-items:center;gap:12px;padding:8px 8px 8px 8px;min-height:52px;text-align:left;font:inherit;color:var(--foreground)}
.pt-item .tx{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}.pt-item .n{font-size:13px;font-weight:500}.pt-item .s{font-size:12px;color:var(--muted-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pt-item>.pt-btn{flex:none;height:28px;padding:0 10px}
.pt-ibox{width:36px;height:36px;flex:none;display:grid;place-items:center;background:var(--muted)}.pt-ibox .pt-ico{color:var(--foreground)}
.pt-item.o{border:1px solid var(--input)}
.pt-item.f{background:var(--muted)}.pt-item.f .pt-ibox{background:var(--background)}
.pt-btn.g:hover{background:color-mix(in oklch,var(--foreground) 8%,transparent)}
.pt-item.t{all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;align-items:center;gap:12px;padding:8px;min-height:52px;border:1px solid var(--input)}
.pt-item.t:hover{background:var(--muted)}.pt-item.t .chev{color:var(--muted-foreground);padding-right:4px}
.pt-item.t:focus-visible{outline:2px solid var(--ring);outline-offset:1px}
.pt-am{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:5}
.pt-end{position:absolute;right:8px;left:auto;top:calc(100% + 4px);z-index:5;width:max-content;min-width:224px;max-width:calc(100% - 16px)}
.pt-irow.tall{height:40px}
.pt-msearch{display:flex;align-items:center;gap:8px;padding:4px 8px 8px;margin-bottom:4px;border-bottom:1px solid color-mix(in oklch,var(--background) 18%,transparent);font-size:13px;opacity:.9}
.pt-q{all:unset;flex:1;font-size:13px;color:inherit;min-width:0}.pt-q::placeholder{color:inherit;opacity:.55}
.pt-mempty{padding:6px 8px;font-size:13px;opacity:.6}
.pt-chg{display:flex;align-items:center;gap:4px;font-size:13px;font-weight:500;color:var(--foreground);padding-right:4px;flex:none}
.pt-item.t:hover{border-color:var(--foreground)}
.pt-selwrap .pt-end{left:auto;right:8px}
.pt-mi{min-width:0;overflow:hidden}.pt-mi .m{overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto}.pt-mi .r{flex:none;padding-left:8px}
:root{--pt-pop:var(--background)}.dark{--pt-pop:oklch(0.16 0 0)}
.pt-cmd{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:5;background:var(--pt-pop);color:var(--foreground);border-radius:2px;box-shadow:0 0 0 1px color-mix(in oklch,var(--foreground) 10%,transparent),0 4px 12px oklch(0 0 0 / 10%);padding:4px 4px 4px;display:flex;flex-direction:column}
.pt-cin{height:32px;display:flex;align-items:center;gap:6px;padding:0 8px;border-radius:2px;background:color-mix(in oklch,var(--foreground) 3.6%,transparent);border:1px solid color-mix(in oklch,var(--foreground) 3.6%,transparent);color:var(--muted-foreground)}
.pt-cin .pt-ico{color:var(--muted-foreground)}.pt-cin .pt-q{color:var(--foreground)}.pt-cin .pt-q::placeholder{color:var(--muted-foreground);opacity:1}
.pt-clist{display:flex;flex-direction:column}
.pt-ch{font-family:var(--font-code);font-size:12px;line-height:16px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted-foreground);padding:6px 8px}
.pt-ci{all:unset;box-sizing:border-box;cursor:pointer;width:100%;height:32px;padding:0 8px;display:flex;align-items:center;gap:8px;font-size:13px;border-radius:2px;min-width:0}
.pt-ci:hover,.pt-ci:focus-visible,.pt-ci[aria-selected=true]{background:var(--muted)}
.pt-ci[aria-disabled=true]{opacity:.5;cursor:default;background:transparent}
.pt-ci>.pt-ico{color:var(--muted-foreground)}.pt-ci .n{white-space:nowrap;flex:none}
.pt-ci .s{font-family:var(--font-code);font-size:12px;color:var(--muted-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.pt-ci .r{margin-left:auto;font-size:12px;color:var(--muted-foreground);white-space:nowrap;flex:none}
.pt-ci .ck{display:flex;flex:none}.pt-ci .ck .pt-ico{color:var(--foreground)}
.pt-cmd .pt-mempty{padding:24px 8px;text-align:center;font-size:13px;color:var(--muted-foreground);opacity:1}
</style>
<script>
(function(){
const REPOS=[["acme/storefront","one app",false],["zschiller/screenplay","4 apps",true],["acme/web","one app",false],["acme/docs","one app",false]];
const MONO=[{n:"app",p:"apps/app",f:"Next.js",port:3000},{n:"docs",p:"apps/docs",f:"Next.js",port:3000},{n:"homepage",p:"apps/homepage",f:"Next.js",port:3000},{n:"skill-templates",p:"packages/skill-templates",f:"Vite",port:5173}];
const FOLDER='<svg class="pt-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M1.5 4.5v8h13v-7H8L6.5 3.5h-5z"/></svg>';
const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
const fld=(l,v,d,ta,ui)=>`<div class="wf-f"><div class="wf-l">${l}</div><div class="wf-i${ta?" wf-ta":""}${ui?" ui":""}">${esc(v)}</div>${d?`<div class="wf-fd">${d}</div>`:""}</div>`;
function mount(el){
 const V=el.dataset.proto; // "A" | "B"
 const S={screen:"settings",repo:null,app:null,adv:false,menu:false,loading:null,added:[{repo:"acme/web",name:""}],trail:[]};
 const T=(t)=>{S.trail.push(t)};
 const addedApps=()=>S.added.filter(a=>a.repo==="zschiller/screenplay").map(a=>a.name);
 const guess=()=>MONO.find(a=>!addedApps().includes(a.n))||MONO[0];
 function go(screen){S.screen=screen;S.menu=false;render()}
 function pickRepo(name){
  const mono=REPOS.find(r=>r[0]===name)[2];
  S.repo=name;S.adv=false;
  if(V==="B"){S.loading=name;render();T(`picked <b>${name}</b>`);
   setTimeout(()=>{S.loading=null; if(mono){S.app=guess().n;T(`${MONO.length} apps found`);go("choose")} else {S.app=null;T("one app, straight to Configure");go("configure")}},900)}
  else {S.app=null;T(`picked <b>${name}</b>`);S.detecting=true;go("configure");
   setTimeout(()=>{S.detecting=false; if(mono){S.app=guess().n;T(/^R[3456]/.test(V)?`${MONO.length} apps found, form appears`:`${MONO.length} apps found, App field appears`)} render()},900)}
 }
 function settings(){
  const rows=S.added.map((a,i)=>`<div class="pt-row${i===S.added.length-1&&S.justAdded?" pt-new":""}">${FOLDER}<span>${a.repo}${a.name?` <span class="lab">${a.name}</span>`:""}</span><span class="r">On</span></div>`).join("");
  return `<div class="wf-dlg"><div class="pt-hd"><div class="wf-t">Canvas settings</div><span class="pt-x">✕</span></div>
  <div class="pt-sec">Repositories</div><div>${rows}</div>
  <div class="wf-ft" style="justify-content:flex-start"><button class="pt-btn o" data-a="new">+ New repository</button></div></div>`;
 }
 function picker(){
  const rows=REPOS.map(r=>`<button class="pt-repo" data-a="repo" data-v="${r[0]}">${FOLDER}<span>${r[0]}</span>${S.loading===r[0]?'<span class="r"><span class="pt-spin"></span>Finding apps…</span>':""}</button>`).join("");
  return `<div class="wf-dlg"><div class="pt-hd"><div class="wf-t">Open GitHub repository</div><span class="pt-x">✕</span></div>
  <div class="pt-search">⌕ Search or paste a clone URL…</div><div class="pt-list">${rows}</div></div>`;
 }
 function choose(){
  const added=addedApps();
  const rows=MONO.map(a=>{const dis=added.includes(a.n),on=S.app===a.n;return `<button class="pt-pick" role="radio" aria-checked="${on}" aria-disabled="${dis}" data-a="${dis?"":"app"}" data-v="${a.n}"><span class="wf-radio${on?" on":""}"></span><span class="tx"><span class="n">${a.n}${dis?'<span class="tag">Added</span>':a.n===guess().n?'<span class="tag">Suggested</span>':""}</span><span class="s">${a.p}</span></span><span class="r">${a.f}</span></button>`}).join("");
  return `<div class="wf-dlg"><div class="pt-hd"><div class="wf-h"><div class="wf-t">Choose an app</div><div class="wf-d">${S.repo} has ${MONO.length} apps. A repository previews one; add it again for another.</div></div><span class="pt-x">✕</span></div>
  <div class="wf-rows" role="radiogroup">${rows}</div><div class="wf-ft"><button class="pt-btn" data-a="back-picker">Back</button><button class="pt-btn p" data-a="continue">Continue</button></div></div>`;
 }
 function configure(){
  const a=S.app?MONO.find(x=>x.n===S.app):null;
  const run=a?`turbo run dev --filter ${a.n}`:(S.detecting?"npm run dev":"pnpm dev");
  const desc=(V==="B"||/^R[3456]/.test(V))&&a?`Confirm the run settings for ${a.n} in ${S.repo} before it’s added.`:`Confirm the run settings for ${S.repo} before it’s added.`;
  let app="";
  if(V==="A"&&a){
   const added=addedApps();
   app=`<div class="wf-f"><div class="wf-l">App</div><div class="pt-selwrap"><button class="pt-sel" data-a="menu" aria-expanded="${S.menu}"><span style="font-weight:500">${a.n}</span><span class="m">${a.p} · ${a.f}</span><span class="chev">⌄</span></button>
   ${S.menu?`<div class="pt-menu" role="menu">${MONO.map(x=>{const dis=added.includes(x.n);return `<button class="pt-mi" role="menuitemradio" aria-checked="${x.n===a.n}" aria-disabled="${dis}" data-a="${dis?"":"app"}" data-v="${x.n}"><span class="ck">${x.n===a.n?"✓":""}</span><span>${x.n}</span><span class="m">${x.p}</span><span class="r">${dis?"Added":x.f}</span></button>`}).join("")}</div>`:""}</div>
   <div class="wf-fd">Found ${MONO.length} apps. A repository previews one; add it again for another.</div></div>`;
  }
  if(/^R[3456]/.test(V)&&a){
   const added=addedApps(); const hint=`<div class="wf-fd">${MONO.length} apps in this repository. Each one you add becomes its own repository.</div>`;
   const opt=(x,cls,inner)=>{const dis=added.includes(x.n),on=x.n===a.n;return `<button class="${cls}" role="radio" aria-checked="${on}" aria-disabled="${dis}" data-a="${dis?"":"app"}" data-v="${x.n}">${inner(x,on,dis)}</button>`};
   if(V==="R3A"){
    app=`<div class="wf-f"><div class="wf-l">App</div><div class="pt-selwrap"><div class="pt-app"><span class="tx"><span class="n">${a.n}</span><span class="s">${a.p} · ${a.f}</span></span><button class="pt-btn o" data-a="menu" aria-expanded="${S.menu}">Change</button></div>
    ${S.menu?`<div class="pt-pop" role="radiogroup">${MONO.map(x=>opt(x,"pt-pick sm",(x,on,dis)=>`<span class="wf-radio${on?" on":""}"></span><span class="tx"><span class="n">${x.n}${dis?'<span class="tag">Added</span>':""}</span><span class="s">${x.p}</span></span><span class="r">${x.f}</span>`)).join("")}</div>`:""}</div>${hint}</div>`;
   } else if(V==="R3B"){
    app=`<div class="wf-f"><div class="wf-l">App</div><div class="pt-chips" role="radiogroup">${MONO.map(x=>opt(x,"pt-chip",(x,on,dis)=>`${x.n}${dis?" · Added":""}`)).join("")}</div><div class="wf-fd">${a.p} · ${a.f}. Each app you add becomes its own repository.</div></div>`;
   } else if(V==="R6"){
    const ico=`<span class="pt-ibox">${FOLDER}</span>`;
    const tx=`<span class="tx"><span class="n">${a.n}</span><span class="s">${a.p} · ${a.f}</span></span>`;
    const UD='<svg class="pt-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M5 6l3-3 3 3M5 10l3 3 3-3"/></svg>';
    const CK='<svg class="pt-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3.5 8.5l3 3 6-7"/></svg>';
    const MAG='<svg class="pt-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3"/></svg>';
    const groups=[...new Set(MONO.map(x=>x.p.split("/")[0]))];
    const it=x=>{const dis=added.includes(x.n),on=x.n===a.n;return `<button class="pt-ci" role="option" aria-selected="${on}" aria-disabled="${dis}" data-a="${dis?"":"app"}" data-v="${x.n}" data-f="${x.n} ${x.p}">${FOLDER}<span class="n">${x.n}</span><span class="s">${x.p}</span><span class="r">${dis?"Added":x.f}</span>${on?`<span class="ck">${CK}</span>`:""}</button>`};
    const menu=S.menu?`<div class="pt-cmd" role="listbox"><div class="pt-cin">${MAG}<input class="pt-q" placeholder="Search apps…" aria-label="Search apps"></div><div class="pt-clist">${groups.map(g=>`<div class="pt-cg" data-g><div class="pt-ch">${g}</div>${MONO.filter(x=>x.p.startsWith(g+"/")).map(it).join("")}</div>`).join("")}<div class="pt-mempty" hidden>No app matches.</div></div></div>`:"";
    app=`<div class="wf-f"><div class="wf-l">App</div><div class="pt-selwrap"><button class="pt-item t" data-a="menu" aria-expanded="${S.menu}" aria-haspopup="listbox">${ico}${tx}<span class="chev">${UD}</span></button>${menu}</div>${hint}</div>`;
   } else if(V.startsWith("R5")){
    const ico=`<span class="pt-ibox">${FOLDER}</span>`;
    const tx=`<span class="tx"><span class="n">${a.n}</span><span class="s">${a.p} · ${a.f}</span></span>`;
    const items=(cls)=>MONO.map(x=>{const dis=added.includes(x.n);return `<button class="pt-mi" role="menuitemradio" aria-checked="${x.n===a.n}" aria-disabled="${dis}" data-a="${dis?"":"app"}" data-v="${x.n}" data-f="${x.n} ${x.p}"><span class="ck">${x.n===a.n?"✓":""}</span><span>${x.n}</span><span class="m">${x.p}</span><span class="r">${dis?"Added":x.f}</span></button>`}).join("");
    const UD='<svg class="pt-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M5 6l3-3 3 3M5 10l3 3 3-3"/></svg>';
    const DN='<svg class="pt-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 6l4 4 4-4"/></svg>';
    let row="",menu="";
    if(V==="R5A"){row=`<div class="pt-item o">${ico}${tx}<button class="pt-btn o" data-a="menu" aria-expanded="${S.menu}" aria-haspopup="menu">Change</button></div>`;
     menu=S.menu?`<div class="pt-menu pt-end" role="menu">${items()}</div>`:"";}
    else if(V==="R5B"){
     row=S.menu?`<div class="pt-ilist" role="radiogroup">${MONO.map(x=>{const dis=added.includes(x.n),on=x.n===a.n;return `<button class="pt-irow tall" role="radio" aria-checked="${on}" aria-disabled="${dis}" data-a="${dis?"":"app"}" data-v="${x.n}"><span class="wf-radio${on?" on":""}"></span><span class="n">${x.n}</span><span class="s">${x.p}</span><span class="r">${dis?"Added":x.f}</span></button>`}).join("")}</div>`
      :`<div class="pt-item o">${ico}${tx}<button class="pt-btn o" data-a="menu" aria-expanded="false">Change</button></div>`;}
    else if(V==="R5C"){row=`<button class="pt-item t" data-a="menu" aria-expanded="${S.menu}" aria-haspopup="listbox">${ico}${tx}<span class="chev">${UD}</span></button>`;
     menu=S.menu?`<div class="pt-menu pt-am" role="listbox"><div class="pt-msearch">⌕ <input class="pt-q" placeholder="Search apps…" aria-label="Search apps"></div>${items()}<div class="pt-mempty" hidden>No app matches.</div></div>`:"";}
    else {row=`<button class="pt-item t" data-a="menu" aria-expanded="${S.menu}" aria-haspopup="menu">${ico}${tx}<span class="pt-chg">Change${DN}</span></button>`;
     menu=S.menu?`<div class="pt-menu pt-am" role="menu">${items()}</div>`:"";}
    app=`<div class="wf-f"><div class="wf-l">App</div><div class="pt-selwrap">${row}${menu}</div>${hint}</div>`;
   } else if(V.startsWith("R4")){
    const ico=`<span class="pt-ibox">${FOLDER}</span>`;
    const tx=`<span class="tx"><span class="n">${a.n}</span><span class="s">${a.p} · ${a.f}</span></span>`;
    const menu=S.menu?`<div class="pt-menu pt-am" role="menu">${MONO.map(x=>{const dis=added.includes(x.n);return `<button class="pt-mi" role="menuitemradio" aria-checked="${x.n===a.n}" aria-disabled="${dis}" data-a="${dis?"":"app"}" data-v="${x.n}"><span class="ck">${x.n===a.n?"✓":""}</span><span>${x.n}</span><span class="m">${x.p}</span><span class="r">${dis?"Added":x.f}</span></button>`}).join("")}</div>`:"";
    const row=V==="R4A"?`<div class="pt-item o">${ico}${tx}<button class="pt-btn o" data-a="menu" aria-expanded="${S.menu}">Change</button></div>`
     :V==="R4B"?`<div class="pt-item f">${ico}${tx}<button class="pt-btn g" data-a="menu" aria-expanded="${S.menu}">Change</button></div>`
     :`<button class="pt-item t" data-a="menu" aria-expanded="${S.menu}" aria-haspopup="menu">${ico}${tx}<span class="chev">⌄</span></button>`;
    app=`<div class="wf-f"><div class="wf-l">App</div><div class="pt-selwrap">${row}${menu}</div>${hint}</div>`;
   } else {
    app=`<div class="wf-f"><div class="wf-l">App</div><div class="pt-ilist" role="radiogroup">${MONO.map(x=>opt(x,"pt-irow",(x,on,dis)=>`<span class="wf-radio${on?" on":""}"></span><span class="n">${x.n}</span><span class="s">${x.p}</span><span class="r">${dis?"Added":x.f}</span>`)).join("")}</div>${hint}</div>`;
   }
  }
  if(/^R[3456]/.test(V)&&S.detecting){
   const sk=`<div class="wf-f"><div class="pt-sk" style="width:30%;height:12px"></div><div class="pt-sk" style="height:32px"></div></div>`;
   return `<div class="wf-dlg"><div class="pt-hd"><div class="wf-h"><div class="wf-t">Configure repository</div><div class="wf-d">Confirm the run settings for ${S.repo} before it’s added.</div></div><span class="pt-x">✕</span></div>
   <div class="pt-status"><span class="pt-spin"></span>Detecting settings…</div>${sk}${sk}${sk}
   <div class="wf-ft"><button class="pt-btn" data-a="back-picker">Back</button><button class="pt-btn p" aria-disabled="true" style="opacity:.5">Add repository</button></div></div>`;
  }
  const status=S.detecting?`<div class="pt-status"><span class="pt-spin"></span>Detecting settings…</div>`:"";
  const adv=S.adv?fld("Default frame size","Laptop  1280×800","The size new frames open at.",false,true)+fld("Agent instructions",a?`Work in the app under ${a.p}.`:"","Extra instructions for the agent in this repository.",true,true)+fld("Name",a?a.n:"","Optional. A short name like “web” or “api”, to tell apart two setups of one repository."):"";
  return `<div class="wf-dlg"><div class="pt-hd"><div class="wf-h"><div class="wf-t">Configure repository</div><div class="wf-d">${desc}</div></div><span class="pt-x">✕</span></div>
  ${status}${app}${fld("Setup script",S.detecting?"":"pnpm install","Runs once when a chat’s code is set up.")}${fld("Run script",S.detecting?"":run,"Starts the app your frames preview.")}
  <button class="pt-adv" data-a="adv" aria-expanded="${S.adv}">${S.adv?"⌄":"›"} Advanced</button>${adv}
  <div class="wf-ft"><button class="pt-btn" data-a="${V==="B"&&a?"back-choose":"back-picker"}">Back</button><button class="pt-btn p" data-a="add">Add repository</button></div></div>`;
 }
 function render(){
  const body={settings,picker,choose,configure}[S.screen]();
  const trail=S.trail.length?`<div class="pt-trail">${S.trail.map((t,i)=>(i?"→ ":"")+t).join(" ")}</div>`:`<div class="pt-trail">Start with <b>New repository</b>, then pick <b>zschiller/screenplay</b> (4 apps) or a one-app repository.</div>`;
  el.innerHTML=`<div class="pt"><div class="pt-bar"><span>${{A:"A · App field",B:"B · Choose an app first",R3A:"A · App row with Change",R3B:"B · App chips",R3C:"C · App list in the form",R4A:"A1 · Outlined row",R4B:"A2 · Filled row",R4C:"A3 · Row as picker",R5A:"A1a · Menu from Change",R5B:"A1b · Change opens the list in place",R5C:"A3a · Searchable picker",R5D:"A3b · Row says Change",R6:"A3a matched to the chat picker"}[V]}, clickable</span><button class="pt-btn o" data-a="reset">Start over</button></div>${trail}<div class="pt-stage">${body}</div></div>`;
 }
 el.addEventListener("input",e=>{if(!e.target.classList.contains("pt-q"))return;const q=e.target.value.toLowerCase();let n=0;el.querySelectorAll(".pt-mi[data-f],.pt-ci[data-f]").forEach(b=>{const show=b.dataset.f.toLowerCase().includes(q);b.hidden=!show;if(show)n++});el.querySelectorAll("[data-g]").forEach(g=>{g.hidden=![...g.querySelectorAll(".pt-ci")].some(b=>!b.hidden)});const em=el.querySelector(".pt-mempty");if(em)em.hidden=n>0});
 el.addEventListener("click",e=>{
  const b=e.target.closest("[data-a]");if(!b||!b.dataset.a)return;const a=b.dataset.a,v=b.dataset.v;
  if(a==="reset"){Object.assign(S,{screen:"settings",repo:null,app:null,adv:false,menu:false,loading:null,detecting:false,justAdded:false,added:[{repo:"acme/web",name:""}],trail:[]});render();return}
  if(a==="new"){S.justAdded=false;T("New repository");go("picker")}
  else if(a==="repo"){if(!S.loading)pickRepo(v)}
  else if(a==="app"){S.app=v;S.menu=false;if(V!=="B")T(`switched to <b>${v}</b>, run script re-filled`);render()}
  else if(a==="continue"){T(`chose <b>${S.app}</b>`);go("configure")}
  else if(a==="back-picker"){T("Back");go("picker")}
  else if(a==="back-choose"){T("Back");go("choose")}
  else if(a==="menu"){S.menu=!S.menu;render();const q=el.querySelector(".pt-q");if(q)q.focus()}
  else if(a==="adv"){S.adv=!S.adv;render()}
  else if(a==="add"){if(S.detecting)return;S.added.push({repo:S.repo,name:S.app||""});S.justAdded=true;T(`added <b>${S.repo}${S.app?" "+S.app:""}</b>`);go("settings")}
 });
 render();
}
const scan=()=>document.querySelectorAll("[data-proto]:not([data-mounted])").forEach(el=>{el.dataset.mounted="1";mount(el)});
new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener("DOMContentLoaded",scan);
})();
</script>
