// The storybook page's data: data.js in the Mockup's folder, which its index.html loads. Every capture path it names loads from the Mockup's folder, relative to index.html, so write each capture there at that path.
const IMG=(p,dk)=>({p,dk}); // p: light (or only) capture, dk: optional dark capture
const PAGE={
 date:"{{DATE}}",
 slug:"{{SLUG}}", // localStorage key, unique per storybook
 round:1, // bump when the owner asks for another round; notes on the page start fresh
 title:"The part's name",
 quote:"The owner's own words that started this storybook.",
 where:"<code>path/to/Part.tsx</code> on main" // where the part lives and which branch the states come from; may hold inline HTML
};
// CONTROLS: one per dimension. values: the choices, first is the default. type "text", "number" or "toggle" (live only) takes any value instead.
const CONTROLS=[
 {key:"status",label:"Status",values:["Idle","Running","Failed"]},
 {key:"title",label:"Title",values:["Short","Long"]}
];
// STATES: the cells of the matrix worth showing, in the order the owner steps through them.
// id: stable, used for notes and the URL hash. set: a value per control (a missing key takes the control's first value).
// shots: the capture, light then optional dark. why: one line on what to look at. said: the owner's earlier note and what changed. why and said may hold inline HTML.
const STATES=[
 {id:"idle",name:"Idle",set:{status:"Idle",title:"Short"},shots:IMG("states/idle-light.png","states/idle-dark.png"),why:""},
 {id:"running-long",name:"Running, long title",set:{status:"Running",title:"Long"},shots:IMG("states/running-long-light.png","states/running-long-dark.png"),why:"The title truncates at 240px (<code>Part.tsx:42</code>)."},
 {id:"failed",name:"Failed",set:{status:"Failed",title:"Short"},shots:IMG("states/failed-light.png","states/failed-dark.png"),why:"",said:""}
];
// Live fidelity: a bundled script, loaded in its own <script src> above this one, sets window.RENDER=(values,el,{theme})=>{...} to render the real part into el. With it, every combination renders and STATES act as presets.
