import json, math, html as H
SP='/tmp/claude-0/-home-user-screenplay/66ca7de8-7705-5421-8c46-6b1d4dfbb6a1/scratchpad'
T=open('/home/user/screenplay/.claude/skills/design-exploration/exploration-template.html').read()
mark='<!-- Generated below this line'
top,rest=T[:T.index(mark)],T[T.index(mark):]
R=json.load(open(SP+'/ranges.json'))
Z=[500,400,330,280,240,200,170,150,130,120,110,100,90,80,70,60,50,40,30]
ZMAX,ZMIN=1.0,0.02
def chart(o):
  rows=R[o]; lw=128; w=360; bw=w-lw-8; rh=18; top_=18
  h=top_+rh*len(rows)+6
  X=lambda z: lw+ (math.log(ZMAX)-math.log(z))/(math.log(ZMAX)-math.log(ZMIN))*bw
  s=[f'<svg viewBox="0 0 {w} {h}" style="width:100%;max-width:520px;height:auto;display:block" role="img" aria-label="Zoom range each label shows at">']
  for t in [1,.5,.25,.1,.05,.02]:
    x=X(t); s.append(f'<line x1="{x:.1f}" x2="{x:.1f}" y1="{top_-4}" y2="{h-4}" stroke="var(--border)" stroke-width="1"/><text x="{x:.1f}" y="11" font-size="9" text-anchor="middle" fill="var(--muted-foreground)" font-family="var(--font-code)">{round(t*100)}%</text>')
  for i,r in enumerate(rows):
    y=top_+i*rh
    g=r['kind']=='g'
    lab=H.escape(r['label'])
    s.append(f'<text x="{lw-8}" y="{y+12}" font-size="10.5" text-anchor="end" fill="var({"--foreground" if g else "--muted-foreground"})" font-weight="{600 if g else 400}" font-family="var(--font-ui)">{lab}</text>')
    if r['low']:
      x2=X(r['low']*0.975)
      s.append(f'<rect x="{lw}" y="{y+4}" width="{x2-lw:.1f}" height="10" rx="1" fill="var({"--foreground" if g else "--muted-foreground"})" opacity="{0.9 if g else 0.45}"/>')
  s.append(f'<line class="cur" x1="0" x2="0" y1="{top_-4}" y2="{h-4}" stroke="var(--ring)" stroke-width="1.5"/>')
  s.append('</svg>')
  return ''.join(s), [round(X(z/1000),1) for z in Z]
def scrub(o, start=120):
  svg,xs=chart(o)
  i=Z.index(start)
  return (f'<div class="lx" data-o="{o}" data-x="{",".join(map(str,xs))}" style="display:grid;gap:10px">'
   f'<img src="s/{o}/z{start:04d}.light.webp" alt="Checkout flow canvas at {start/10:g}%" style="width:100%;border:1px solid var(--border);border-radius:4px">'
   f'<label style="display:flex;gap:12px;align-items:center;font:13px var(--font-ui)"><span class="zv" style="min-width:40px;font-variant-numeric:tabular-nums">{start/10:g}%</span>'
   f'<input type="range" min="0" max="{len(Z)-1}" value="{i}" style="flex:1;min-width:0;accent-color:var(--ring)" aria-label="Zoom"></label>'
   f'<div style="font:12px var(--font-ui);color:var(--muted-foreground)">Drag to zoom out. Bars show where each label is visible; bold rows are group names.</div>'
   f'{svg}</div>')
IMG=lambda o,z,cap: f'IMG("s/{o}/z{z:04d}.light.webp",{json.dumps(cap)},"s/{o}/z{z:04d}.dark.webp")'
def shots(o,n): return '['+IMG(o,280,f'{n} · 28%')+','+IMG(o,120,f'{n} · 12%')+']'
data='''<script>
const IMG=(p,cap,dk)=>({p,cap,dk});
const Z=@@0@@;
document.addEventListener("input",e=>{const t=e.target;if(!t.matches||!t.matches(".lx input"))return;const r=t.closest(".lx");const z=Z[+t.value];r.querySelector("img").src="s/"+r.dataset.o+"/z"+String(z).padStart(4,"0")+".light.webp";r.querySelector("img").alt="Checkout flow canvas at "+z/10+"%";r.querySelector(".zv").textContent=z/10+"%";const x=r.dataset.x.split(",")[+t.value];const c=r.querySelector(".cur");c.setAttribute("x1",x);c.setAttribute("x2",x)});
new MutationObserver(()=>document.querySelectorAll(".lx").forEach(r=>{if(r.dataset.init)return;r.dataset.init=1;const i=r.querySelector("input");const x=r.dataset.x.split(",")[+i.value];const c=r.querySelector(".cur");c.setAttribute("x1",x);c.setAttribute("x2",x)})).observe(document.documentElement,{childList:true,subtree:true});
const PAGE={
 date:"6 Oct 2026",
 slug:"label-visibility-2026-10-06",
 quote:"which labels get shown/hidden at different zoom levels feels a bit random",
 q:"What rule should decide which canvas labels show as you zoom out?"
};
const TODAY={facts:[
 "Two rules hide a label (<code>lib/canvas/layer-labels.ts:94</code>): its Layer is under 64px wide on screen, or, below 25% only (<code>camera.ts:145</code>), its 20px strip (42px with a group name) overlaps another Layer. From 25% up, room is never tested, so crossing 25% flips labels by itself.",
 "Room is tested across the Layer’s or Group’s whole width, so the tightest gap anywhere under it decides. The iPhone frame is 74px taller than its row, and that hides the Cart group name at 25% even though “Cart” sits far to the left of it.",
 "Group names and member names decide separately. On the Checkout flow canvas, Cart loses its group name at 25% while its members keep theirs to 11% and 17%, and Empty cart ideas loses its group name at 11% while its members keep theirs to 5%.",
 "Neighbours in one row disagree: Untitled frame hides at 17% (the iPhone above it) while Empty cart beside it stays to 11%.",
 "Phones and documents go before desktops by the width rule: Checkout · iPhone at 17%, the 720px Document and Mockup at 9%, 1280px frames at 5%.",
 "Labels decide on the settled zoom (<code>canvas-member-layer.tsx:268</code> reads <code>camera.zoom</code>, which lands when motion stops, <code>use-canvas-camera.ts:100</code>), so they pop in or out after you stop zooming, not as you pass the point.",
 "Chats on labels drop per label where the name plus 40px doesn’t fit (<code>label-chat.tsx</code>, PR #1761)."
],html:@@1@@,shots:[IMG("s/today/z0280.light.webp","Today · 28%","s/today/z0280.dark.webp"),IMG("s/today/z0120.light.webp","Today · 12%","s/today/z0120.dark.webp")]};
const ROUNDS=[
{n:1,feedback:"",every:[
 "No global zoom cutoff: every option decides per Layer or per Group from on-screen size and room.",
 "Labels decide on the live zoom, so a label hides as you pass its point rather than after you stop.",
 "Chats keep today’s rule (PR #1761), and labels stay UI size in the screen-space layer (PR #1780).",
 "Captures are the real app on the Checkout flow canvas (1512×982 window) with each rule swapped in. The slider steps from 50% to 3%."
],questions:[
 {key:"rule",title:"",intro:"",options:[
  {id:"A",name:"Rows agree",why:"Keep today’s two measures, but test room once per Group, across the whole Group, at every zoom (no 25% switch). A Group’s labels go in a fixed order: its group name first, then all its member names together, so neighbours in a row never disagree.",cost:"Room is still measured against the tightest gap, so a row beside a taller frame loses labels earlier than today (Cart’s group name at 34%, its names at 17%). Far out it looks like Today: at 7% the two are identical.",state:"",html:@@2@@,shots:@@3@@},
  {id:"B",name:"Width only",why:"Figma’s rule: a label shows while its Layer is at least 64px wide on screen, and never hides for lack of room. Same-size frames always agree, and the only thing that hides a label is its own frame getting small.",cost:"In tight stacks labels print over the frame above: from about 20% down, “Cart” sits on Checkout · desktop’s bottom edge (see 12%). Phones and documents still go before desktops.",state:"",html:@@4@@,shots:@@5@@},
  {id:"C",name:"Groups take over",rec:true,why:"A Group shows its full labels while they all fit (room for both lines across the Group, every member at least 64px wide). When they don’t, only the group name shows, on the name row, and it goes last. Far out you read one name per Group, and a group name never vanishes before its members.",cost:"Member names go earlier where a row is tight or holds a phone: Checkout’s names at 17% (the iPhone hits 64px), Cart’s at 34%. Lone Layers like Order receipt email keep today’s per-Layer rule.",state:"",html:@@6@@,shots:@@7@@}
 ]}
]}
];
</script>
'''
html_today=scrub('today'); 
vals=[json.dumps(Z),json.dumps(html_today),json.dumps(scrub('a')),shots('a','A'),json.dumps(scrub('b')),shots('b','B'),json.dumps(scrub('c')),shots('c','C')]
out=data
for i,v in enumerate(vals): out=out.replace('@@%d@@'%i,v)
# replace template's data script
i=top.index('<script>'); j=top.index('</script>')+len('</script>')
page=top[:i].replace('{{TITLE}}','Canvas Label Visibility')+out+rest
open(SP+'/pub/label-visibility.html','w').write(page)
print(len(page))
