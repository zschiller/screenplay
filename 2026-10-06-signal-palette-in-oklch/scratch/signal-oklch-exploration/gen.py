from ok import *
from opts import mc
import json
FILL={'destructive':27,'attention':55,'warning':95,'success':148,'info':330,'merged':293,'blue':250,'cyan':205}
INK={'destructive':27,'success':148,'warning':60,'info':326,'merged':293}
def Yof(L,C,h): return lin_to_xyz_srgb(*clip_srgb(L,C,h)[0])[1]
def solve(f,T,h,lo=0.3,hi=0.97):
  for _ in range(40):
    m=(lo+hi)/2
    if f(m,h)<T: lo=m
    else: hi=m
  return round(lo,3)
hkf=lambda L,h: hk(L,mc(L,h),h)[1]
dark_ink=lambda L,h: -wcag(Yof(L,mc(L,h),h),1)
today_fill={'destructive':(0.66,0.225,27),'attention':(0.74,0.182,55),'warning':(0.88,0.179,95),'success':(0.82,0.235,148),'info':(0.72,0.284,330),'merged':(0.66,0.198,293),'blue':(0.72,0.16,250),'cyan':(0.84,0.14,205)}
today_ink={'destructive':(0.56,0.226,27),'success':(0.56,0.16,148),'warning':(0.6,0.139,60),'info':(0.56,0.259,326),'merged':(0.54,0.282,293)}
band={'destructive':0.70,'attention':0.75,'warning':0.82,'success':0.75,'info':0.72,'merged':0.72,'blue':0.75,'cyan':0.77}
P={'today':(today_fill,today_ink),
 'a':({k:(0.74,mc(0.74,h),h) for k,h in FILL.items()},{k:(0.55,mc(0.55,h),h) for k,h in INK.items()}),
 'b':({k:(band[k],mc(band[k],h),h) for k,h in FILL.items()},{k:(solve(dark_ink,-5.0,h),mc(solve(dark_ink,-5.0,h),h),h) for k,h in INK.items()}),
 'c':({k:(solve(hkf,78,h),mc(solve(hkf,78,h),h),h) for k,h in FILL.items()},{k:(solve(hkf,57,h),mc(solve(hkf,57,h),h),h) for k,h in INK.items()}),
}
P['a'][1]['info']=today_ink['info'] if False else P['a'][1]['info']
out={}
for n,(F,I) in P.items():
  rows=[]
  for grp,D,ref in (('fill',F,0),('ink',I,1)):
    for k,(L,C,h) in D.items():
      Y=Yof(L,C,h); rows.append(dict(group=grp,name=k,css=f"oklch({L} {C} {h})",hex=hexs(clip_srgb(L,C,h)[0]),hk=round(hk(L,C,h)[1],1),black=round(wcag(Y,0),1),white=round(wcag(Y,1),1)))
  out[n]=rows
  hks=[r['hk'] for r in rows if r['group']=='fill' and r['name'] in ('destructive','attention','warning','success','info','merged')]
  ihk=[r['hk'] for r in rows if r['group']=='ink']
  print(n,'fill HK spread',min(hks),max(hks),round(max(hks)-min(hks),1),'ink HK',min(ihk),max(ihk),'ink white min',min(r['white'] for r in rows if r['group']=='ink'))
  for r in rows: print('  ',r)
  F2={k:f"oklch({L} {C} {h})" for k,(L,C,h) in F.items()}; I2={k:f"oklch({L} {C} {h})" for k,(L,C,h) in I.items()}
  if n!='today':
    css=":root,html,.dark .inverted{"+''.join(f"--{k}:{I2[k]}!important;" for k in I2)+''.join(f"--{k}-fill:{F2[k]}!important;" for k in ('destructive','success','warning','info','merged','attention'))+"}\n"
    css+="html.dark,.dark,:root:not(.dark) .inverted{"+''.join(f"--{k}:{F2[k]}!important;--{k}-fill:{F2[k]}!important;" for k in ('destructive','success','warning','merged'))+f"--info-fill:{F2['info']}!important;--attention-fill:{F2['attention']}!important;}}\n"
    css+=f"html,html.dark{{--canvas-snap:{F2['destructive']}!important;--canvas-inspect:{F2['merged']}!important;--canvas-highlight:{F2['merged']}!important;--canvas-comment:{F2['warning']}!important;--canvas-selection-fill:{F2['info']}!important;}}\n"
    open(f'opt-{n}.css','w').write(css)
json.dump(out,open('palettes.json','w'),indent=1)
