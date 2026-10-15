from ok import *
import json,sys
H={'destructive':27,'attention':55,'warning':95,'success':148,'info':330,'merged':293,'blue':250,'cyan':205,'lime':125}
today={'destructive':(0.66,0.225,27),'attention':(0.74,0.182,55),'warning':(0.88,0.179,95),'success':(0.82,0.235,148),'info':(0.72,0.284,330),'merged':(0.66,0.198,293),'blue':(0.72,0.16,250),'cyan':(0.84,0.14,205)}
def mc(L,h,f=0.99): return round(maxC(L,h,xyz_to_srgb)*f,3)
def solveHK(T,h):
  lo,hi=0.4,0.97
  for _ in range(40):
    m=(lo+hi)/2
    if hk(m,mc(m,h),h)[1]<T: lo=m
    else: hi=m
  return round(lo,3)
def show(name,P):
  print(name)
  for k,(L,C,h) in P.items():
    r,_=clip_srgb(L,C,h); Y=lin_to_xyz_srgb(*r)[1]
    print(f"  {k:12} oklch({L} {C} {h}) {hexs(r)} HK={hk(L,C,h)[1]:.1f} vsBlack={wcag(Y,0):.1f}")
if __name__=="__main__": show("today",today)
if __name__=="__main__":
 for L in map(float,sys.argv[1].split(',')):
  show(f'A L={L}',{k:(L,mc(L,h),h) for k,h in H.items()})
 for T in map(float,sys.argv[2].split(',')):
   P={}
   for k,h in H.items():
     L=solveHK(T,h); P[k]=(L,mc(L,h),h)
   show(f'B HK={T}',P)
