import json,sys
d=json.load(open(sys.argv[1]))
prev={}
for r in d:
  z=r['zoom']
  for l in r['labels']:
    st=(l['vis'], l['groupText'].split('\n')[0] if l['group'] else None, tuple(l['chats']), l['compact'])
    if prev.get(l['id'])!=st:
      print(f"{z*100:6.1f}%  {l['id']:26s} vis={st[0]} group={st[1]} chats={st[2]} compact={st[3]}  text={l['text'][:50]!r}")
      prev[l['id']]=st
