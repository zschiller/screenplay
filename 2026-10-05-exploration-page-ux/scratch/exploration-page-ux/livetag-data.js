const IMG=(p,cap,dk)=>({p,cap,dk});
const S=(o)=>[IMG(`r1/${o}-live-light.png`,`${o==="today"?"Today":o} · Live, nobody has control`,`r1/${o}-live-dark.png`),IMG(`r1/${o}-control-light.png`,`${o==="today"?"Today":o} · Ana has control`,`r1/${o}-control-dark.png`)];
const PAGE={
 date:"3 Oct 2026",
 slug:"live-tag-control",
 quote:"i feel like the live facepile thing is weird now that everyone on the canvas is in live automatically. it also feels inconsistent w/ the control interaction pill. can we resolve that",
 q:"What should a live frame’s title line show, and how should it sit with the control tag?"
};
const TODAY={facts:[
 "Selected frame, nobody in control: eight 8px handles on the pink selection ring, background fill, 1px pink outline, drawn on the selection overlay (<code>selection-overlay.tsx:329</code>).",
 "Selected frame while Ana has control: the pink ring stays, the handles are gone (<code>canvas.tsx:2419</code>, <code>live-page.tsx:526</code>), and the title line says “Ana has control”.",
 "Nobody else can resize while one person has control; the person in control can’t either while they interact."
],shots:[IMG("r2/idle-light.png","Today · selected, nobody in control","r2/idle-dark.png"),IMG("r2/today-light.png","Today · selected, Ana has control","r2/today-dark.png")]};
const ROUNDS=[
{n:3,feedback:"Zack on round 2: “the gray handles are not noticeable enough i think, they look almost the same. what about lower opacity? idk”",every:[
 "Selected frame while Ana has control; the handles don’t resize and the cursor stays the arrow.",
 "The pink selection ring, the “Ana has control” pill and the Interact button are unchanged unless an option says so.",
 "Mockups get the same."
],questions:[
 {key:"faded",title:"",intro:"Compare each against Today’s normal handles (first card).",options:[
  {id:"A",name:"Faded handles",why:"Today’s pink handles with their outline at 40% opacity; the fill stays solid so the ring doesn’t show through. Your idea: same shape and spot, visibly switched off.",cost:"A faded state is new to the canvas (the Signal palette avoids tints elsewhere).",rec:true,state:"",shots:[IMG("r3/F-light.png","A · Ana has control","r3/F-dark.png")]},
  {id:"B",name:"Dot markers",why:"The handles become 5px solid pink dots in the same eight spots: they mark the selection’s corners and edges but no longer look like square grips.",cost:"A second handle shape to learn, and dots are small at a glance.",state:"",shots:[IMG("r3/D-light.png","B · Ana has control","r3/D-dark.png")]},
  {id:"C",name:"Faded + dashed ring",why:"A’s faded handles, and the selection ring turns dashed while someone else has control, so the whole frame reads as locked, not just its corners.",cost:"Changes the ring too, which also shows when you don’t look at the handles. Dashes are drawn per frame size.",state:"",shots:[IMG("r3/R-light.png","C · Ana has control","r3/R-dark.png")]}
 ]}
]},
{n:2,feedback:"Zack (round 1 picked B, building in PR #1580): “can we show the handles but disable them so its still clear what is selected? can we do some design on what that might look like”",every:[
 "The handles stay in their eight spots on the pink selection ring while someone else has control, and dragging them does nothing.",
 "The cursor over them stays the arrow, not a resize cursor.",
 "The “Ana has control” pill, the ring and the Interact button are unchanged.",
 "Mockups get the same."
],questions:[
 {key:"handles",title:"",intro:"Selected frame while Ana has control.",options:[
  {id:"A",name:"Grey handles",why:"Same squares with a muted grey outline instead of pink. Greyed-out is how every tool says “disabled”, and the pink ring still says the frame is selected.",cost:"None beyond the new handle colour.",rec:true,state:"rejected",shots:[IMG("r2/A-light.png","A · Ana has control","r2/A-dark.png")]},
  {id:"B",name:"Controller’s colour",why:"The handles take Ana’s cursor colour, matching her pill, so they say who holds the frame right now.",cost:"Pale cursor colours nearly vanish on the light canvas, and the agent’s would be ink.",state:"rejected",shots:[IMG("r2/B-light.png","B · Ana has control","r2/B-dark.png")]},
  {id:"C",name:"Unchanged handles",why:"Today’s pink handles stay as they are; they just don’t resize, and hovering one shows a not-allowed cursor.",cost:"Looks resizable until you try, which is the confusion disabled controls avoid.",state:"rejected",shots:[IMG("r2/C-light.png","C · Ana has control","r2/C-dark.png")]}
 ]}
]},
{n:1,feedback:"",every:[
 "The faces leave the title line. Live now means everyone on the canvas, so the header’s avatars already say who is watching.",
 "The Go live toggle, the Interact button and its driver face stay as they are.",
 "Each option shows two moments: live with nobody in control, then Ana taking control."
],questions:[
 {key:"tag",title:"",intro:"",options:[
  {id:"A",name:"Just “Live”",why:"Keep today’s muted “Live” and drop the faces, 22px wide. The smallest change: it fixes the facepile and leaves everything else alone.",cost:"Live and control still differ in form, muted text against a filled pill, so the inconsistency stays.",state:"rejected",shots:S("A")},
  {id:"B",name:"Live pill",why:"“Live” becomes an outlined pill, the Go live toggle’s broadcast icon plus the word, in the control tag’s exact shape: 18px tall, 4px radius, 6px padding, 12px medium. Control swaps in on the same spot in its cursor colour.",cost:"A 1px outline on the title line, a little heavier than today’s muted text. 50.7px wide.",rec:true,state:"picked",shots:S("B")},
  {id:"C",name:"One pill",why:"B, and the broadcast icon also stays inside the control pill, so taking control reads as a state of the live frame rather than a different tag.",cost:"Control without live would need a second control pill without the icon. Control pill grows to 114.7px.",state:"rejected",shots:S("C")},
  {id:"D",name:"Both quiet",why:"Make control match Live instead: muted “Ana has control” with her 16px face, in the title’s type, no fill.",cost:"Reverses the coloured driver tag picked in the control exploration (#1376), so a frame someone controls no longer reads from across the canvas.",state:"rejected",shots:S("D")}
 ]}
]}
];
