from ok import *
from opts import mc
import json
d=json.load(open('palettes.json'))
def row(name,L,C,h):
  rr,_=clip_srgb(L,C,h); Y=lin_to_xyz_srgb(*rr)[1]
  return dict(group='fill',name=name,css=f"oklch({L} {C} {h})",hex=hexs(rr),hk=round(hk(L,C,h)[1],1),black=round(wcag(Y,0),1),white=round(wcag(Y,1),1))
sets={
 'r3a':{'destructive':(0.66,0.224,27),'merged':(0.66,0.198,293),'warning':(0.88,0.179,95),'lime':(0.9,0.2,125),'attention':(0.74,0.182,55),'blue':(0.716,0.155,249),'lavender':(0.78,0.129,300)},
 'r3b':{'destructive':(0.63,0.253,27),'merged':(0.62,0.225,293),'warning':(0.88,0.179,95),'lime':(0.9,0.2,125),'attention':(0.74,0.182,55),'blue':(0.716,0.155,249),'lavender':(0.78,0.129,300)},
}
for k,s in sets.items():
  rows=[dict(r) for r in d['r2b']]
  for i,r in enumerate(rows):
    if r['group']=='fill' and r['name'] in s: rows[i]=row(r['name'],*s[r['name']])
  d[k]=rows
  print(k,[(r['name'],r['css'],r.get('hex'),r.get('hk'),r.get('black')) for r in rows if r['group']=='fill'])
  F={r['name']:r['css'] for r in rows if r['group']=='fill'}; I={r['name']:r['css'] for r in rows if r['group']=='ink'}
  css=":root,html,.dark .inverted{"+''.join(f"--{x}:{I[x]}!important;" for x in I)+''.join(f"--{x}-fill:{F[x]}!important;" for x in ('destructive','success','warning','info','merged','attention'))+"}\n"
  css+="html.dark,.dark,:root:not(.dark) .inverted{"+''.join(f"--{x}:{F[x]}!important;--{x}-fill:{F[x]}!important;" for x in ('destructive','success','warning','merged'))+f"--info-fill:{F['info']}!important;--attention-fill:{F['attention']}!important;}}\n"
  css+=f"html,html.dark{{--canvas-snap:{F['destructive']}!important;--canvas-inspect:{F['merged']}!important;--canvas-highlight:{F['merged']}!important;--canvas-comment:{F['warning']}!important;--canvas-selection-fill:{F['info']}!important;}}\n"
  open(f'opt-{k}.css','w').write(css)
json.dump(d,open('palettes.json','w'),indent=1)
