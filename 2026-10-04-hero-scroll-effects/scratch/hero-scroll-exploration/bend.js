(()=>{let y0=null;const R=220,K=1.3,M=32*Math.PI/180,FADE=300;
const P=u=>{if(u<=0)return[-u,0];const q=R*M;if(u<q){const f=u/R;return[-R*Math.sin(f),-(R-R*Math.cos(f))]}const d=u-q;return[-R*Math.sin(M)-d*Math.cos(M),-(R-R*Math.cos(M))-d*Math.sin(M)]};
const sm=t=>{t=Math.min(Math.max(t,0),1);return t*t*(3-2*t)};
const run=()=>{const ts=[...document.querySelectorAll(".hc-track")];if(!ts.length)return;
if(y0===null){const hdr=document.querySelector("header").getBoundingClientRect().bottom;const t=ts.find(t=>t.getBoundingClientRect().top>hdr-10)||ts[0];y0=t.offsetTop;}
const yb=y0+K*scrollY;
for(const t of ts){const h=t.offsetHeight,yBot=t.offsetTop+h;const ub=yb-yBot,ut=ub+h;
const pb=P(ub),pt=P(ut);const dy=pt[0]-pb[0],dz=pt[1]-pb[1];const th=Math.atan2(-dz,-dy)*180/Math.PI;
const Y=yb+pb[0],Z=pb[1];t.style.transformOrigin="50% 100%";t.style.translate=`0 ${(Y-yBot).toFixed(2)}px ${Z.toFixed(2)}px`;t.style.rotate=`x ${th.toFixed(2)}deg`;
t.style.opacity=String(1-0.95*sm((ub+h/2)/FADE))}};
addEventListener("scroll",run,{passive:true});})()
