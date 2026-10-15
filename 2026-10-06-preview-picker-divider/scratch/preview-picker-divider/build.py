import re, json
t = open('/home/user/screenplay/.claude/skills/design-exploration/exploration-template.html').read()
states = [("short","2 running previews"),("long-top","14 previews, opened"),("long-mid","14 previews, scrolled halfway"),("long-end","14 previews, scrolled to the end")]
def shots(o, name, r="r1"):
    return "[" + ",".join(f'IMG("{r}/{o}-{s}-light.png","{name} · {cap}","{r}/{o}-{s}-dark.png")' for s,cap in states) + "]"
data = '''<script>
const IMG=(p,cap,dk)=>({p,cap,dk});
const PAGE={
 date:"6 October 2026",
 slug:"preview-picker-divider",
 quote:"the divider line between chats &amp; new chat on the popover when drawing a frame is weird. can you do fine detail design exploration and refinement on that, it just looks weird not going edge to edge and feels unresolved w/ how scroll might work",
 q:"How should the running-previews picker separate New chat… from the previews, short list and long?"
};
const TODAY={facts:[
 "Drawing a frame opens <b>PreviewPicker</b> in a 352px card (<code>frame-ask-card.tsx:299</code>): stock shadcn Command, search on top, running previews (likely one first), a divider, then <b>New chat…</b>.",
 "Why the line stops short: <code>CommandSeparator</code> is <code>-mx-1</code> to reach the card edge, but <code>CommandList</code> is <code>overflow-x-hidden</code> (<code>packages/ui/…/command.tsx:96</code>), which clips it to the list box. Measured: the list is 344px inside a 352px card, so the line ends <b>4px short of each edge</b>. This is the only CommandSeparator in the app.",
 "Why scroll feels unresolved: New chat… sits <i>inside</i> the scrolling list (<code>max-h-72</code>, 288px). With 2 previews the card is 157px and nothing scrolls. With 14 it scrolls, and New chat… and its divider are below the fold until you reach the end. Rows also slide under the search field with no edge.",
 "Constraint: the card is centred on its first height so nothing jumps (PR #1763); every option keeps that. Rows stay 32px, the card stays 352px.",
 "The 14-preview list is cloned rows for the capture; the fixture has 2 running previews."
],shots:''' + shots("today","Today") + '''};
const ROUNDS=[
{n:2,feedback:"Round 1 pick: <b>C, pinned footer, lines only while scrolled</b>. Note: “resolve the padding a bit”.",every:[
 "C’s behaviour, unchanged: New chat… pinned under the list, a line above it only while there’s more below, a line under the search only once you’ve scrolled.",
 "Fixed from round 1: C added 4px above the first row once you scrolled, so the list jumped. Now scrolling only shows or hides the lines; nothing moves.",
 "The list has no top padding inside its scroll (your dialog rule), so rows scroll flush under the search line.",
 "Same keys and paths as today: Enter shows the likely preview, ↓ reaches New chat… last, words that match nothing make it New chat: “…”, Esc closes.",
 "Build note: cmdk only finds items inside <code>CommandList</code>, so the build keeps New chat… in the list and moves the scroll to an inner box around the previews. No new variant in <code>packages/ui</code>."
],questions:[
 {key:"padding",title:"Spacing",intro:"Round 1’s C had three different gaps: 5px under the search, 13px between the last preview and New chat…, 8px under it. Both options make every gap the same.",options:[
  {id:"A",name:"8px all round",why:"Search, rows and footer all sit 8px from the card edges, today’s inset. Every gap is 8px: card to search, search to the first row, last row to New chat… (the line sits in the middle of that gap), and New chat… to the bottom. Short list: 162px tall, same as round 1.",cost:"None beyond C. Keeps stock Command’s 8px inset.",rec:true,state:"",shots:''' + shots("a","A","r2") + '''},
  {id:"B",name:"4px, menu density",why:"Everything at 4px, like our dropdown menus: search and row highlights sit 4px from the edges, and each gap is 4px. Short list is 146px, 16px shorter.",cost:"Search and highlights get wider than in the chat picker and every other Command, which keep 8px. It reads as a menu more than a picker.",state:"",shots:''' + shots("b","B","r2") + '''}
 ]}
]},
{n:1,feedback:"",every:["The line, when there is one, runs the full 352px, edge to edge.","Same rows, search, order and keyboard as today: ↑↓ and Enter still reach New chat… last.","Captures are the real app with CSS injected, light and dark."],questions:[
 {key:"divider",title:"Divider and New chat…",intro:"",options:[
  {id:"A",name:"Fix the line, keep the list",why:"The smallest fix: make the separator actually reach both edges and leave New chat… where it is, at the end of the scrolling list. It answers “not edge to edge” and nothing else.",cost:"Doesn’t touch the scroll problem: with a long list New chat… is still out of sight until you scroll to the bottom, and rows still slide under the search with no edge. Needs the card to own the side padding instead of Command (a class change in <code>frame-ask-card.tsx</code>, no new variant).",state:"rejected",shots:''' + shots("a","A") + '''},
  {id:"B",name:"Pinned footer, line always",why:"New chat… moves out of the list into a footer that never scrolls, with a full-width line above it. Only the previews scroll, between the search and the footer, so New chat… is always one click away. This is GitHub’s branch-picker pattern (“View all branches” pinned under a rule).",cost:"The line shows even when two rows don’t scroll, which the dialog rule avoids. The top edge is still unresolved: scrolled rows slip under the search with no line.",state:"rejected",shots:''' + shots("b","B") + '''},
  {id:"C",name:"Pinned footer, lines only while scrolled",why:"Same pinned footer as B, but hairlines follow your dialog rule: the line above New chat… shows only while there’s more list below it, and a line under the search shows once the list is scrolled off its top. Short list: no lines at all, just an 8px gap. Long list: the edges say there’s more, and both ends feel finished.",cost:"A small scroll listener on the list (two data attributes, as the dialogs already do). Without a line in the short case, New chat… reads as the last row with a gap, not a separate section.",rec:true,state:"picked",shots:''' + shots("c","C") + '''},
  {id:"D",name:"New chat beside the search",why:"Drop the divider altogether: New chat becomes a 28px plus icon button beside the search field, and the list holds only previews. Nothing to separate, nothing to scroll past. When nothing matches, the list would show the single New chat: “…” row today already shows.",cost:"New chat… loses its label and becomes an icon that needs a tooltip; keyboard reaches it only through the no-match row or Tab. A bigger change to an interaction that just shipped.",state:"rejected",shots:''' + shots("d","D") + '''}
 ]}
]}
];
</script>'''
start = t.index('<script>')
end = t.index('</script>', start) + len('</script>')
t = t[:start] + data + t[end:]
t = t.replace('{{TITLE}}', 'Preview picker divider')
open('preview-picker-divider.html', 'w').write(t)
