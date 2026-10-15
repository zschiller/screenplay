import sys,glob,os
import numpy as np
from PIL import Image
src,dst=sys.argv[1],sys.argv[2]
os.makedirs(dst,exist_ok=True)
for f in sorted(glob.glob(src+'/*.png')):
    im=Image.open(f).convert('RGB'); a=np.asarray(im).astype(int)
    m=(a[:,:,0]>200)&(a[:,:,1]<90)&(a[:,:,2]>200)
    m[:, :500]=False  # ignore sidebar
    ys,xs=np.nonzero(m)
    # selection handles: take largest cluster -> use percentile bounds
    x0,x1=np.percentile(xs,1),np.percentile(xs,99); y0,y1=np.percentile(ys,1),np.percentile(ys,99)
    cx,cy=(x0+x1)/2,(y0+y1)/2
    W,H=880,1040
    box=(int(cx-W/2),int(cy-H/2),int(cx+W/2),int(cy+H/2))
    n=os.path.basename(f).replace('.png','').replace('.light','-light').replace('.dark','-dark').replace('dm-','')
    im.crop(box).save(os.path.join(dst,n+'.png'))
    print(n,box)
