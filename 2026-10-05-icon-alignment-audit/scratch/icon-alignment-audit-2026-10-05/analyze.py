import json,sys,collections
rows=[json.loads(l) for f in sys.argv[1:] for l in open(f) if l.strip()]
print(len(rows),"rows")
def flag(r):
    return r['dCap'] < -0.75 or r['dX'] > 0.75
bad=[r for r in rows if flag(r)]
print(len(bad),"flagged")
dist=collections.Counter(round(r['dCap']*2)/2 for r in rows)
print("dCap dist",sorted(dist.items()))
groups=collections.defaultdict(list)
for r in bad:
    key=(r.get('tag','page')[:30],r['ctx'].split('<')[0], r['fontSize'], r['lh'], tuple(r['iconSize']), round(r['dCap']*2)/2)
    groups[key].append(r)
for k,v in sorted(groups.items(), key=lambda kv:-len(kv[1])):
    ex=v[0]
    print(len(v),k,'|',ex['screen'],'|',ex['text'][:30],'|',ex['icon'],'| dX',ex['dX'],'| line',ex['dLine'],'| base',ex.get('baseErr'))
