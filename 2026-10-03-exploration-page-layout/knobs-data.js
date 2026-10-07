window.EXPLORATION={
 "PAGE": {
  "date": "3 Oct 2026",
  "q": "How should the Knobs panel lay out and draw its controls?",
  "quote": "Zack: “i feel like knobs in general are ugly can we do a pass on them”",
  "slug": "proto-knobs",
  "every": [
   "The colour knob becomes a field with a small swatch and the hex value, styled like the text field next to it.",
   "Two or three short options show as Tabs (PR #1463). Hero layout is shown as Center / Left.",
   "Captures are the docs world (Northwind homepage frame) restyled in place: canvas popover first, player panel second."
  ]
 },
 "TODAY": {
  "facts": "One KnobsPanel serves the canvas popover and the player (components/knobs-panel.tsx), 288px wide in the popover. Measured on the docs world: the five knobs make rows of 28, 28, 50, 20 and 50px with a 12px gap, because short controls sit beside their label and wide ones stack under it, so the panel zigzags (284px tall). The colour knob is a native <input type=color> at 48×28 in a bordered box, so its swatch floats inside padding and looks different on every OS. The slider is the stock shadcn one: a 6px track with a solid ink range across most of the panel. Labels are 12px, fields 28px.",
  "shots": [
   {
    "p": "today/canvas-light.png",
    "cap": "Today · Canvas popover",
    "dk": "today/canvas-dark.png"
   },
   {
    "p": "today/player-light.png",
    "cap": "Today · Player panel",
    "dk": "today/player-dark.png"
   }
  ],
  "summary": "One KnobsPanel, 288px wide; rows zigzag between 20 and 50px"
 },
 "ROUNDS": [
  {
   "n": 4,
   "feedback": "Zack picked Info icon: “the last control shouldn’t get a divider under, and the popover needs some breathing room on bottom.”",
   "questions": [
    {
     "key": "panel",
     "title": "The panel so far",
     "intro": "All four picks together: right column, groups with mono headings, hover descriptions marked by an info icon. No hairline under the last knob of a group, and 12px more room under the last knob, so it sits 18px from the bottom edge.",
     "options": [
      {
       "id": "P",
       "name": "Combined panel",
       "why": "Each knob is a 40px row with its control in a fixed 136px column on the right. Groups get a mono section label, and hairlines separate knobs only within a group. The colour field shows a swatch and hex, short choices show as tabs, and described knobs carry an info icon whose tooltip holds the description.",
       "cost": "New optional description and group fields on the knob declaration, in the knobs package, the Mockup runtime and the add-knob skill. Nothing new in the component kit: the tooltip is the stock Tooltip and the icon is the app’s InfoIcon.",
       "rec": true,
       "state": "",
       "shots": [
        {
         "p": "r4/canvas-light.png",
         "cap": "Canvas popover",
         "dk": "r4/canvas-dark.png"
        },
        {
         "p": "r4/player-light.png",
         "cap": "Player panel",
         "dk": "r4/player-dark.png"
        }
       ]
      }
     ]
    }
   ]
  },
  {
   "n": 3,
   "feedback": "Zack picked Right column, On hover and Groups: “we use mono for group headers, right?” Yes: group headings now use the app’s section-label style (Geist Mono, 12px, uppercase, wider tracking, muted), the same as menu, select and sidebar group labels.",
   "questions": [
    {
     "key": "marker",
     "title": "How a described knob shows it has a description",
     "intro": "Every shot is the three picks together, with the Corner radius tooltip held open. Corner radius and Show customer logos have descriptions.",
     "options": [
      {
       "id": "A",
       "name": "Dotted underline",
       "why": "The label of a described knob gets a dotted underline, the web’s usual hint that hovering explains a term. Adds nothing to the row’s width.",
       "cost": "A new pattern in the app, and easy to miss at 12px.",
       "state": "",
       "shots": [
        {
         "p": "r3-a/canvas-light.png",
         "cap": "A · Canvas popover",
         "dk": "r3-a/canvas-dark.png"
        },
        {
         "p": "r3-a/player-light.png",
         "cap": "A · Player panel",
         "dk": "r3-a/player-dark.png"
        }
       ]
      },
      {
       "id": "B",
       "name": "Info icon",
       "why": "A 14px muted info icon after the label, which is the icon the app already has (InfoIcon). It is the most common way to say “there’s more here”, and it can take keyboard focus and a tap on touch screens, so the description is reachable without a mouse.",
       "cost": "One more glyph per described knob, 18px wider. With long labels it eats into the gap before the control column.",
       "rec": true,
       "state": "picked",
       "shots": [
        {
         "p": "r3-b/canvas-light.png",
         "cap": "B · Canvas popover",
         "dk": "r3-b/canvas-dark.png"
        },
        {
         "p": "r3-b/player-light.png",
         "cap": "B · Player panel",
         "dk": "r3-b/player-dark.png"
        }
       ]
      },
      {
       "id": "C",
       "name": "No marker",
       "why": "The label alone; hovering any described label shows its tooltip. Cleanest row.",
       "cost": "Nobody knows a description exists until they happen to hover, and keyboard and touch users never see it.",
       "state": "",
       "shots": [
        {
         "p": "r3-c/canvas-light.png",
         "cap": "C · Canvas popover",
         "dk": "r3-c/canvas-dark.png"
        },
        {
         "p": "r3-c/player-light.png",
         "cap": "C · Player panel",
         "dk": "r3-c/player-dark.png"
        }
       ]
      }
     ]
    }
   ]
  },
  {
   "n": 2,
   "feedback": "Zack: “something around inspector rows and settings list. also should knobs have optional descriptions? should we allow more layout flexibility and options for the model to design the knob panel itself?”",
   "questions": [
    {
     "key": "look",
     "title": "Look: Inspector rows × Settings list",
     "intro": "All three keep B's single control line and C's 40px rows with hairlines between them. They differ in how fields are drawn and where the control column sits.",
     "options": [
      {
       "id": "A",
       "name": "Divided inspector",
       "why": "B's rows, spaced out like C. Labels in the foreground colour, a hairline under each knob, and stock bordered fields that fill the column starting right after the longest label. Every field still looks editable.",
       "cost": "Panel is 240px, 8px taller than round 1 B. The headline still scrolls inside a 136px field.",
       "rec": true,
       "state": "",
       "shots": [
        {
         "p": "r2-a/canvas-light.png",
         "cap": "A · Canvas popover",
         "dk": "r2-a/canvas-dark.png"
        },
        {
         "p": "r2-a/player-light.png",
         "cap": "A · Player panel",
         "dk": "r2-a/player-dark.png"
        }
       ]
      },
      {
       "id": "B",
       "name": "Quiet fields",
       "why": "Same rows and column as A, but the colour value and text field drop their border, so values read like C's settings list. Recommended only if you liked how calm C looked.",
       "cost": "A borderless text field and colour value are a one-off style, not stock shadcn, and nothing says the headline or hex can be edited until you hover.",
       "state": "",
       "shots": [
        {
         "p": "r2-b/canvas-light.png",
         "cap": "B · Canvas popover",
         "dk": "r2-b/canvas-dark.png"
        },
        {
         "p": "r2-b/player-light.png",
         "cap": "B · Player panel",
         "dk": "r2-b/player-dark.png"
        }
       ]
      },
      {
       "id": "C",
       "name": "Right column",
       "why": "C's arrangement with stock fields: labels take the left, and every control sits in a fixed 136px column on the right, so all right edges line up and the switch moves to the far right like a settings list.",
       "cost": "With short labels the controls stay narrow and leave a gap in the middle; with long ones it is the same as A. The switch sits away from the other controls' left edge.",
       "state": "picked",
       "shots": [
        {
         "p": "r2-c/canvas-light.png",
         "cap": "C · Canvas popover",
         "dk": "r2-c/canvas-dark.png"
        },
        {
         "p": "r2-c/player-light.png",
         "cap": "C · Player panel",
         "dk": "r2-c/player-dark.png"
        }
       ]
      }
     ]
    },
    {
     "key": "desc",
     "title": "Optional descriptions",
     "intro": "A new optional description on the knob declaration, next to label. Corner radius and Show customer logos have one here; the others don't.",
     "options": [
      {
       "id": "D1",
       "name": "Under the row",
       "why": "A muted 12px line under the label and control, across the full row, so it never wraps beside a field. Only knobs that have one get taller.",
       "cost": "Each described knob adds 18px. Long descriptions wrap to a second line, so the skill would ask for a short phrase.",
       "rec": true,
       "state": "",
       "shots": [
        {
         "p": "r2-desc-under/canvas-light.png",
         "cap": "D1 · Canvas popover",
         "dk": "r2-desc-under/canvas-dark.png"
        },
        {
         "p": "r2-desc-under/player-light.png",
         "cap": "D1 · Player panel",
         "dk": "r2-desc-under/player-dark.png"
        }
       ]
      },
      {
       "id": "D2",
       "name": "On hover",
       "why": "The label of a described knob gets a dotted underline, and hovering it shows the description in the standard inverted tooltip. The panel stays as compact as A.",
       "cost": "Hidden until you hover, and touch screens can't hover. The dotted underline is a new pattern in the app.",
       "state": "picked",
       "shots": [
        {
         "p": "r2-desc-hover/canvas-light.png",
         "cap": "D2 · Canvas popover",
         "dk": "r2-desc-hover/canvas-dark.png"
        },
        {
         "p": "r2-desc-hover/player-light.png",
         "cap": "D2 · Player panel",
         "dk": "r2-desc-hover/player-dark.png"
        }
       ]
      },
      {
       "id": "D3",
       "name": "No descriptions",
       "why": "Keep labels only. A label that needs explaining gets a clearer label.",
       "cost": "The agent has nowhere to say what a knob affects when the name alone is vague, like “Density”.",
       "state": "",
       "shots": []
      }
     ]
    },
    {
     "key": "layout",
     "title": "How much of the panel the agent designs",
     "intro": "Today the agent picks each knob's type and label; the panel decides everything else, in declaration order.",
     "options": [
      {
       "id": "L1",
       "name": "Fixed panel",
       "why": "Keep today's model: one list in declaration order. The agent controls order and types only.",
       "cost": "A frame with 12 knobs is one long undivided list.",
       "state": "",
       "shots": []
      },
      {
       "id": "L2",
       "name": "Groups",
       "why": "An optional group name on each knob. Knobs with the same group sit under a small muted heading, with a hairline between groups, in the order they first appear. The agent gets structure; the panel keeps one look on every frame.",
       "cost": "One new field in the knobs package, the mockup runtime and the skill. Groups don't collapse; with very many knobs the panel still scrolls.",
       "rec": true,
       "state": "picked",
       "shots": [
        {
         "p": "r2-groups/canvas-light.png",
         "cap": "L2 · Canvas popover",
         "dk": "r2-groups/canvas-dark.png"
        },
        {
         "p": "r2-groups/player-light.png",
         "cap": "L2 · Player panel",
         "dk": "r2-groups/player-dark.png"
        }
       ]
      },
      {
       "id": "L3",
       "name": "Layout hints",
       "why": "Groups plus per-knob hints, such as a half-width knob so two short ones share a row, or a stacked knob for a long text value that should get the full width.",
       "cost": "More ways for panels to come out ragged, which is the problem round 1 fixed. The agent would need rules about when to use each hint.",
       "state": "",
       "shots": []
      },
      {
       "id": "L4",
       "name": "Agent-designed panel",
       "why": "The agent writes the panel's own markup, and Screenplay renders it in place of the list.",
       "cost": "Every frame's panel would look different and none would follow the app's design rules. Prototype code can't run in the app's own UI, so the panel would have to be its own iframe. The agent can already put any controls it likes inside the page itself.",
       "state": "",
       "shots": []
      }
     ]
    }
   ]
  },
  {
   "n": 1,
   "feedback": "",
   "options": [
    {
     "id": "A",
     "name": "Tidy",
     "why": "Keep today's layout: short controls beside the label, slider and text field stacked under it. Fix only the parts that look broken: the colour field, Tabs for short choices, and a fixed 12px rhythm between knobs.",
     "cost": "Smallest change. The panel still zigzags between one-line and two-line knobs (265px tall here), which is most of what reads as messy.",
     "state": "rejected",
     "shots": [
      {
       "p": "r1-a/canvas-light.png",
       "cap": "A · Canvas popover",
       "dk": "r1-a/canvas-dark.png"
      },
      {
       "p": "r1-a/player-light.png",
       "cap": "A · Player panel",
       "dk": "r1-a/player-dark.png"
      }
     ]
    },
    {
     "id": "B",
     "name": "Inspector rows",
     "why": "Recommended because one row per knob fixes the zigzag, which is the main thing that reads as ugly, using only stock components. Every knob is one 28px row: label on the left, control on the right, like the property panels in Figma or Leva. The label column hugs the longest label (120px here, nothing truncated), so every control starts on one vertical line. Labels go muted so the values lead. The slider gets a 4px track and 14px thumb to sit in a row, with its value at the end.",
     "cost": "A long text value shows its start and scrolls inside the field (“Know what your users act…”) because the field is 132px. A very long label squeezes the control column; past half the panel it needs a cap. Panel drops from 284 to 232px.",
     "rec": true,
     "state": "picked",
     "shots": [
      {
       "p": "r1-b/canvas-light.png",
       "cap": "B · Canvas popover",
       "dk": "r1-b/canvas-dark.png"
      },
      {
       "p": "r1-b/player-light.png",
       "cap": "B · Player panel",
       "dk": "r1-b/player-dark.png"
      }
     ]
    },
    {
     "id": "C",
     "name": "Settings list",
     "why": "Each knob is a 40px row with a hairline between rows, label left and a compact control right, like macOS System Settings. Values read as values: the hex sits beside its swatch with no box, the headline is right-aligned text that edits in place, and the slider is a fixed 112px.",
     "cost": "The borderless text field and colour value are a one-off style outside stock shadcn, and the headline no longer looks editable until hovered. Rows are taller, so the panel is barely shorter than today (236px).",
     "state": "picked",
     "shots": [
      {
       "p": "r1-c/canvas-light.png",
       "cap": "C · Canvas popover",
       "dk": "r1-c/canvas-dark.png"
      },
      {
       "p": "r1-c/player-light.png",
       "cap": "C · Player panel",
       "dk": "r1-c/player-dark.png"
      }
     ]
    }
   ]
  }
 ]
};
