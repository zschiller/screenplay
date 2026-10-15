import sys,os
from PIL import Image
src='/home/user/screenplay/apps/app/.screenshots/captures'
os.makedirs('page/shots',exist_ok=True)
for label,key in [('today','today'),('opt-a','a'),('opt-b','b'),('opt-c','c'),('opt-r2a','r2a'),('opt-r2b','r2b'),('opt-r2c','r2c'),('opt-r3a','r3a'),('opt-r3b','r3b')]:
  for th in ('light','dark'):
    for scr,box,name in [('workspaces-menu',(2330,10,3010,640),'menu'),('canvas-agent-chat',(2132,0,3024,720),'chat')]:
      p=f'{src}/{label}/{scr}.{th}.png'
      if os.path.exists(p): Image.open(p).crop(box).save(f'page/shots/{key}-{name}-{th}.png',optimize=True)
    p=f'out/spec-{key}.{th}.png'
    if os.path.exists(p): Image.open(p).save(f'page/shots/{key}-spec-{th}.png',optimize=True)
