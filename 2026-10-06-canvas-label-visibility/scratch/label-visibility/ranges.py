import json
NAMES={'layer-checkout-desktop':'Checkout · desktop','layer-checkout-mobile':'Checkout · iPhone 17 Pro','doc-checkout-brief':'Checkout brief','layer-cart-desktop':'Empty cart','layer-unbound':'Untitled frame','layer-cart-live':'Empty cart · live','mockup-cart-illustrated':'Option A · Illustrated','mockup-cart-suggestions':'Option B · Suggestions','mockup-receipt':'Order receipt email'}
GROUPS={'layer-checkout-desktop':'Checkout','layer-cart-desktop':'Cart','layer-cart-live':'Empty cart ideas'}
ORDER=[('g','layer-checkout-desktop'),('n','layer-checkout-desktop'),('n','layer-checkout-mobile'),('n','doc-checkout-brief'),('g','layer-cart-desktop'),('n','layer-cart-desktop'),('n','layer-unbound'),('g','layer-cart-live'),('n','layer-cart-live'),('n','mockup-cart-illustrated'),('n','mockup-cart-suggestions'),('n','mockup-receipt')]
out={}
for o,f in [('today','today/sweep.json'),('a','a/sweep.json'),('b','b/sweep.json'),('c','c/sweep.json')]:
  d=json.load(open(f)); res=[]
  for kind,id in ORDER:
    low=None
    for r in d:
      l=next(x for x in r['labels'] if x['id']==id)
      if kind=='g': v=l['vis'] and bool(l['groupText']) and l['groupText'].startswith(GROUPS[id])
      else: v=l['vis'] and (NAMES[id] in l['text'] or l['text'].rstrip('…. ').startswith(NAMES[id][:4]) and not (l['groupText'] and l['text'].strip()==l['groupText'].replace('\n',' ').strip()))
      if v: low=r['zoom']
    res.append({'kind':kind,'label':GROUPS[id] if kind=='g' else NAMES[id],'low':low})
  out[o]=res
  print(o, [(x['label'][:12], round(x['low']*100,1) if x['low'] else None) for x in res])
json.dump(out,open('ranges.json','w'))
