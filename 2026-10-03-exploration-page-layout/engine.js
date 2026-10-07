(()=>{
const CFG=Object.assign({layout:"now",compare:"deck"},window.CFG||{});
const {PAGE,TODAY}=window.EXPLORATION;
let ROUNDS=window.EXPLORATION.ROUNDS;
if(CFG.upto){ROUNDS=ROUNDS.filter(r=>r.n<=CFG.upto);(ROUNDS[0].questions||[{options:ROUNDS[0].options}]).forEach(q=>q.options.forEach(o=>o.state=""))}
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const $=id=>document.getElementById(id);
const qs=r=>r.questions||[{key:"pick",title:"",intro:"",options:r.options}];
const latest=ROUNDS[0];
const SIGN=[["ok","Looks good"],["changes","Needs changes"]];
const signoff=q=>q.options.length===1;

// Saved picks for the open round only
const KEY="exploration-"+PAGE.slug;
let saved={};try{saved=JSON.parse(localStorage.getItem(KEY)||"{}")}catch(e){}
const state=saved.round===latest.n?{picks:saved.picks||{},note:saved.note||""}:{picks:{},note:""};
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify({round:latest.n,...state}))}catch(e){}};

const shots=list=>list&&list.length?`<div class="shots">`+list.map(i=>`<figure><button type="button" class="shot${i.dk?" has-dk":""}" data-lt="${esc(i.p)}" data-dk="${esc(i.dk||"")}" aria-label="Enlarge ${esc(i.cap)}"><img class="lt" src="${esc(i.p)}" alt="${esc(i.cap)}" loading="lazy">${i.dk?`<img class="dk" src="${esc(i.dk)}" alt="" aria-hidden="true" loading="lazy">`:""}</button><figcaption>${esc(i.cap)}</figcaption></figure>`).join("")+`</div>`:"";
const badges=o=>(o.rec?'<span class="badge rec">Recommended</span>':"")+(o.state?`<span class="badge ${o.state}">${o.state==="picked"?"Picked":"Rejected"}</span>`:"");
function choose(q,o){
 const cur=state.picks[q.key];
 if(signoff(q))return `<div class="choose">`+SIGN.map(([v,l])=>`<button type="button" data-q="${q.key}" data-v="${v}" aria-pressed="${cur===v}">${l}</button>`).join("")+`</div>`;
 return `<div class="choose"><button type="button" data-q="${q.key}" data-v="${o.id}" aria-pressed="${cur===o.id}">${cur===o.id?"Picked":"Pick "+esc(o.id)}</button></div>`;
}
const card=(q,o,live)=>`<article class="opt ${o.state||""}" data-id="${esc(o.id)}"><header><span class="letter">${esc(o.id)}</span><h3>${esc(o.name)}</h3>${badges(o)}</header>${o.html||""}${shots(o.shots)}<p class="why">${o.why||""}</p>${o.cost?`<p class="cost"><b>Cost</b> ${o.cost}</p>`:""}${live?choose(q,o):""}</article>`;
const todayCard=()=>`<article class="opt today" data-id="Today"><header><span class="letter">Today</span><h3>What main does now</h3></header>${TODAY.html||""}${shots(TODAY.shots)}</article>`;

function question(r,q,i,live){
 const n=qs(r).length;
 const head=(q.title||n>1)?`<div class="qhead">${n>1?`<p class="lbl acc">Question ${i+1} of ${n}</p>`:""}${q.title?`<h2>${esc(q.title)}</h2>`:""}${q.intro?`<p class="muted">${q.intro}</p>`:""}</div>`:"";
 const withToday=live&&TODAY.compare!==false&&((TODAY.shots&&TODAY.shots.length)||TODAY.html);
 const cards=(withToday?todayCard():"")+q.options.map(o=>card(q,o,live)).join("");
 if(live&&CFG.compare==="deck"){
  const ids=(withToday?["Today"]:[]).concat(q.options.map(o=>o.id));
  return `<div class="question" data-q="${q.key}">${head}<div class="chips" role="tablist" aria-label="Options">`+ids.map(id=>`<button type="button" data-go="${esc(id)}">${esc(id)}</button>`).join("")+`</div><div class="track">${cards}</div></div>`;
 }
 return `<div class="question" data-q="${q.key}">${head}<div class="opts">${cards}</div></div>`;
}
const roundBody=(r,live,bare)=>(!bare&&r.feedback?`<blockquote>${r.feedback}</blockquote>`:"")+qs(r).map((q,i)=>question(r,q,i,live)).join("");
const todayBody=()=>`${TODAY.facts?`<ul class="facts">${[].concat(TODAY.facts).map(f=>`<li>${f}</li>`).join("")}</ul>`:""}${TODAY.html||""}${shots(TODAY.shots)}`;
function outcome(r){
 const picked=qs(r).flatMap(q=>q.options.filter(o=>o.state==="picked").map(o=>signoff(q)?`Signed off ${o.name}`:`${o.id}: ${o.name}`));
 return picked.length?picked.join(" · "):qs(r).flatMap(q=>q.options).every(o=>o.state==="rejected")?"All rejected":"No pick";
}
const every=r=>{const e=r.every||PAGE.every;return e?fold("every","In every option",e[0].replace(/<[^>]+>/g,""),`<ul class="facts">${e.map(x=>`<li>${x}</li>`).join("")}</ul>`,ROUNDS.length===1):""};
const fold=(cls,title,sum,body,open)=>`<details class="fold ${cls}"${open?" open":""}><summary><span class="lbl">${title}</span><span class="sum">${esc(sum)}</span></summary><div class="body">${body}</div></details>`;
const ledger=()=>ROUNDS.slice(1).map(r=>fold("past",`Round ${r.n}`,outcome(r),roundBody(r,false))).join("");
const openTitle=()=>{const Q=qs(latest);return Q.length>1?`${Q.length} questions`:signoff(Q[0])?"Sign off":`${Q[0].options.length} options`};
const header=`<header><div class="top"><p class="lbl acc">Design exploration · ${esc(PAGE.date)}</p><button type="button" class="ghost" id="theme">Dark</button></div><h1>${esc(PAGE.q)}</h1><blockquote>${esc(PAGE.quote)}</blockquote></header>`;
const nowSection=`<section id="now"><div class="shead"><p class="lbl acc">Round ${latest.n} · open</p><h2>${openTitle()}</h2></div>${latest.feedback?`<blockquote>${latest.feedback}</blockquote>`:""}${every(latest)}${roundBody(latest,true,true)}</section>`;

let html;
if(CFG.layout==="tabs"){
 const past=ROUNDS.length-1;
 html=header+`<nav class="tabs" role="tablist"><button role="tab" data-tab="now" aria-selected="true">Round ${latest.n}</button><button role="tab" data-tab="today" aria-selected="false">Today</button>${past?`<button role="tab" data-tab="past" aria-selected="false">Earlier rounds · ${past}</button>`:""}</nav>`+
  nowSection.replace('<section id="now">','<section id="now" data-panel="now">')+
  `<section data-panel="today" hidden><div class="shead"><p class="lbl">Today</p><h2>What main does now</h2></div>${todayBody()}</section>`+
  (past?`<section data-panel="past" hidden><div class="shead"><p class="lbl">Earlier rounds</p><h2>${past} round${past>1?"s":""}, newest first</h2></div><div class="ledger">${ledger()}</div></section>`:"");
}else{
 html=header+fold("today","Today on main",TODAY.summary||"What main does now",todayBody(),!!TODAY.open)+nowSection+
  (ROUNDS.length>1?`<section><div class="shead"><p class="lbl">Earlier rounds</p><h2>How we got here</h2></div><div class="ledger">${ledger()}</div></section>`:"");
}
document.body.insertAdjacentHTML("afterbegin",`<div class="wrap">${html}</div>
<div class="bar" id="bar"><div class="in"><textarea id="note" aria-label="Note" placeholder="Anything to add" hidden></textarea><div class="row"><div class="picks" id="picks" role="status" aria-live="polite"></div><button type="button" id="noteBtn">Note</button><button type="button" class="primary" id="copy">Copy reaction</button></div></div></div>
<dialog class="lb" id="lb"><div class="in"><img alt=""></div></dialog>`);
if(CFG.layout==="tabs")document.documentElement.style.setProperty("--stick",document.querySelector(".tabs").offsetHeight+"px");

// Picks
function line(q){
 const v=state.picks[q.key];if(!v)return null;
 if(signoff(q))return `${q.options[0].name}: ${SIGN.find(s=>s[0]===v)[1]}`;
 const o=q.options.find(x=>x.id===v);return `${q.title?q.title+": ":""}${o.id}: ${o.name}`;
}
function build(){
 const lines=qs(latest).map(q=>"→ "+(line(q)||`${q.title?q.title+": ":""}No pick yet`));
 return [`Exploration: ${PAGE.q}`,`Round ${latest.n}`,...lines].concat(state.note.trim()?[`Note: ${state.note.trim()}`]:[]).join("\n");
}
function sync(){
 const Q=qs(latest),done=Q.filter(q=>state.picks[q.key]);
 $("picks").innerHTML=done.length?done.map(q=>{const v=state.picks[q.key];return `<b>${esc(signoff(q)?SIGN.find(s=>s[0]===v)[1]:Q.length>1?v:v+": "+q.options.find(o=>o.id===v).name)}</b>`}).join(" · ")+(Q.length>1?` <span>${done.length} of ${Q.length} answered</span>`:""):(Q.length>1?`0 of ${Q.length} answered`:signoff(Q[0])?"Sign off or say what to change":"No pick yet");
 document.querySelectorAll(".choose button").forEach(b=>{
  const on=state.picks[b.dataset.q]===b.dataset.v;b.setAttribute("aria-pressed",on);
  if(!SIGN.some(s=>s[0]===b.dataset.v))b.textContent=on?"Picked":"Pick "+b.dataset.v;
 });
 document.querySelectorAll(".question").forEach(el=>el.querySelectorAll(".chips button").forEach(c=>c.classList.toggle("chosen",state.picks[el.dataset.q]===c.dataset.go)));
 save();
}
document.addEventListener("click",e=>{
 const b=e.target.closest(".choose button");
 if(b){const q=b.dataset.q;state.picks[q]=state.picks[q]===b.dataset.v?undefined:b.dataset.v;if(b.dataset.v==="changes"&&state.picks[q])openNote();sync();return}
 const go=e.target.closest(".chips button");
 if(go){const t=go.closest(".question").querySelector(".track"),c=t.querySelector(`.opt[data-id="${CSS.escape(go.dataset.go)}"]`);t.scrollTo({left:c.offsetLeft-t.offsetLeft,behavior:"smooth"});return}
 const tab=e.target.closest(".tabs button");
 if(tab){document.querySelectorAll(".tabs button").forEach(x=>x.setAttribute("aria-selected",x===tab));document.querySelectorAll("[data-panel]").forEach(p=>p.hidden=p.dataset.panel!==tab.dataset.tab);scrollTo({top:0});return}
 const s=e.target.closest(".shot");
 if(s){const dark=getComputedStyle(s.querySelector(".lt")).display==="none";const lb=$("lb");lb.querySelector("img").src=dark&&s.dataset.dk?s.dataset.dk:s.dataset.lt;lb.showModal();return}
 if(e.target.closest("#lb"))$("lb").close();
});
// Chip follows the swipe
document.querySelectorAll(".track").forEach(t=>{
 const chips=[...t.previousElementSibling.querySelectorAll("button")];
 const cards=[...t.children];
 // On a phone the track takes the height of the card in view, so a short card leaves no gap
 const mark=()=>{const i=Math.min(cards.length-1,Math.round(t.scrollLeft/(t.clientWidth+16)));chips.forEach((c,j)=>c.setAttribute("aria-current",j===i));t.style.height=getComputedStyle(chips[0].parentNode).display==="none"?"":cards[i].offsetHeight+"px"};
 t.addEventListener("scroll",()=>requestAnimationFrame(mark),{passive:true});addEventListener("resize",mark);t.querySelectorAll("img").forEach(im=>im.addEventListener("load",mark));mark();
});
function openNote(){const n=$("note");n.hidden=false;n.focus()}
$("noteBtn").addEventListener("click",()=>{const n=$("note");n.hidden=!n.hidden;if(!n.hidden)n.focus()});
$("note").value=state.note;if(state.note)$("note").hidden=false;
$("note").addEventListener("input",e=>{state.note=e.target.value;save()});
$("copy").addEventListener("click",()=>{
 const text=build(),b=$("copy");
 const done=t=>{b.textContent=t;setTimeout(()=>b.textContent="Copy reaction",1800)};
 const fallback=()=>{const n=$("note");n.hidden=false;n.value=text;n.select();done("Select and copy")};
 try{navigator.clipboard.writeText(text).then(()=>done("Copied"),fallback)}catch(e){fallback()}
});
// Theme switch, so the other theme's captures are one tap away
const root=document.documentElement,mq=matchMedia("(prefers-color-scheme: dark)");
const isDark=()=>root.dataset.theme?root.dataset.theme==="dark":mq.matches;
const label=()=>$("theme").textContent=isDark()?"Light":"Dark";
$("theme").addEventListener("click",()=>{root.dataset.theme=isDark()?"light":"dark";label()});label();
sync();
})();
