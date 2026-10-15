from ok import *
from opts import mc
import json
def solveC(L,h,T):
  lo,hi=0,mc(L,h)
  for _ in range(40):
    m=(lo+hi)/2
    if hk(L,m,h)[1]<T: lo=m
    else: hi=m
  return round(lo,3)
def solveL(h,T):
  lo,hi=0.5,0.85
  for _ in range(40):
    m=(lo+hi)/2
    if hk(m,mc(m,h),h)[1]<T: lo=m
    else: hi=m
  return round(lo,3)
def pinkAt(T): # half lightness drop, rest from chroma
  Ld=solveL(330,T); L=round((0.72+Ld)/2,3); return (L,solveC(L,330,T),330)
def greenAt(T,h=148):
  L=solveL(h,T); return (L,mc(L,h),h)
d=json.load(open('palettes.json'))
base={r['name']:r for r in d['b'] if r['group']=='fill'}
def parse(css): a=css[6:-1].split(); return (float(a[0]),float(a[1]),float(a[2]))
out={}
for key,T,red in (('r2a',72.5,None),('r2b',76.5,None),('r2c',75,0.72)):
  rows=[dict(r) for r in d['b']]
  for r in rows:
    if r['group']!='fill': continue
    v=None
    if r['name']=='info': v=pinkAt(T)
    if r['name']=='success': v=greenAt(T)
    if r['name']=='cyan': v=greenAt(T,205)
    if r['name']=='destructive' and red: v=(red,mc(red,27),27)
    if v:
      L,C,h=v; rr,_=clip_srgb(L,C,h); Y=lin_to_xyz_srgb(*rr)[1]
      r.update(css=f"oklch({L} {C} {h})",hex=hexs(rr),hk=round(hk(L,C,h)[1],1),black=round(wcag(Y,0),1),white=round(wcag(Y,1),1))
  out[key]=rows
  print(key,[(r['name'],r['css'],r['hex'],r['hk'],r['black']) for r in rows if r['group']=='fill'])
d.update(out); json.dump(d,open('palettes.json','w'),indent=1)
for key,rows in out.items():
  F={r['name']:r['css'] for r in rows if r['group']=='fill'}; I={r['name']:r['css'] for r in rows if r['group']=='ink'}
  css=":root,html,.dark .inverted{"+''.join(f"--{k}:{I[k]}!important;" for k in I)+''.join(f"--{k}-fill:{F[k]}!important;" for k in ('destructive','success','warning','info','merged','attention'))+"}\n"
  css+="html.dark,.dark,:root:not(.dark) .inverted{"+''.join(f"--{k}:{F[k]}!important;--{k}-fill:{F[k]}!important;" for k in ('destructive','success','warning','merged'))+f"--info-fill:{F['info']}!important;--attention-fill:{F['attention']}!important;}}\n"
  css+=f"html,html.dark{{--canvas-snap:{F['destructive']}!important;--canvas-inspect:{F['merged']}!important;--canvas-highlight:{F['merged']}!important;--canvas-comment:{F['warning']}!important;--canvas-selection-fill:{F['info']}!important;}}\n"
  open(f'opt-{key}.css','w').write(css)
