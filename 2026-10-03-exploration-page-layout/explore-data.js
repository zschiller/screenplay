const IMG=(p,cap,dk)=>({p,cap,dk});
const open=(href,label)=>`<p><a href="${href}">${label||"Open the working page"}</a>, built on the Knobs exploration's rounds 1 to 3.</p>`;
window.EXPLORATION={
PAGE:{date:"3 Oct 2026",slug:"exploration-page-layout",
 q:"How should an exploration page put the open question first and work on a phone?",
 quote:"Zack: “Right now it is tedious to scroll past the current state every time and hard to parse out what is current questions vs old exploration. I also want to optimize for mobile.” And: “If it's presenting a single option, e.g. for sign-off, it shouldn't need to use the questions tool.”"},
TODAY:{summary:"On a phone the open round starts 2.3 screens down and the form 4.3",
 facts:[
 "Measured on the Knobs page at phone width (390 × 844): the page is 4,200px tall. The open round starts 1,929px down, after the question, In every option and Today, and the reaction form starts 3,594px down, after every option.",
 "Earlier rounds sit behind a row of numbered buttons. Their outcome, what was picked, only shows once you open each one.",
 "The template has one question per round. The Knobs page added several questions per round by hand, and Live frames swapped captures for drawn strips, so each page forks the template.",
 "A round with one option still gets the full form: a radio for it, “None of these”, and a decision card in the chat (Knobs round 4)."],
 shots:[IMG("today/first-light.png","Today · First screen","today/first-dark.png"),IMG("today/round-light.png","Today · Open round, 2.3 screens down","today/round-dark.png"),IMG("today/form-light.png","Today · Form, 4.3 screens down","today/form-dark.png")]},
ROUNDS:[{n:1,feedback:"",
 every:[
 "Each option has its own Pick button, and a bar pinned to the bottom shows your picks with Note and Copy reaction. The form at the end of the page goes away.",
 `A question with one option is a sign-off: Looks good or Needs changes instead of Pick, and the chat just posts the link, with no decision card. <a href="signoff.html">See Knobs round 4 as a sign-off</a>.`,
 "A round can ask several questions, each with its own pick, and an option can show captures or drawn wireframes.",
 "Captures show your device's theme, with a Light / Dark switch in the header. Tap a capture to see it full size.",
 "This page is itself A + D, so you can try it here."],
 questions:[
 {key:"layout",title:"Where the page puts things",intro:"Both open on the question and the open round. They differ in where Today and earlier rounds go.",options:[
  {id:"A",name:"Open round first",rec:true,
   why:"One scroll. Today folds into one line under the question, open only in round 1. Earlier rounds become a list below the open round, one row each with what was picked, so the history reads as decisions and opens on tap. "+open("now-deck.html"),
   cost:"Today's captures are a tap away rather than on screen; the Today card in each question covers comparing against them.",
   shots:[IMG("a/first-light.png","A · First screen","a/first-dark.png"),IMG("a/ledger-light.png","A · Earlier rounds, one open","a/ledger-dark.png")]},
  {id:"B",name:"Tabs",
   why:"A tab bar under the question: the open round, Today, Earlier rounds. The page opens on the round and shows nothing else. "+open("tabs-deck.html"),
   cost:"History and Today are out of sight, so looking back means switching tabs and losing your place. One more control on a page you visit once a round.",
   shots:[IMG("b/first-light.png","B · First screen","b/first-dark.png"),IMG("b/earlier-light.png","B · Earlier rounds tab","b/earlier-dark.png")]}
 ]},
 {key:"compare",title:"How options sit on a phone",intro:"On a wide screen both lay the options side by side, as today.",options:[
  {id:"D",name:"Swipe deck",rec:true,
   why:"One option at a time, with chips for Today, A, B, C above it. Swipe or tap a chip and the next option's captures land in the same spot, so flipping between Today and B works like a before and after. A picked option's chip gets a tick. "+open("now-deck.html"),
   cost:"You read one option's text at a time. Swiping is less discoverable than scrolling, which the chips make up for.",
   shots:[IMG("d/today-light.png","D · Question opens on Today","d/today-dark.png"),IMG("d/b-light.png","D · On B, picked","d/b-dark.png")]},
  {id:"S",name:"Stacked",
   why:"Options follow one another down the page with Today first, each with its own Pick button. "+open("now-stack.html"),
   cost:"Comparing A with C means scrolling past B, and each option with two captures is about two screens tall on a phone.",
   shots:[IMG("s/options-light.png","S · Options in a column","s/options-dark.png")]}
 ]}
]}]};
