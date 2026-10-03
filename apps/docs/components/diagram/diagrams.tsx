/*
 * The docs' diagrams, drawn with the kit in ./kit.tsx. Each is registered in
 * mdx-components.tsx and used on one page.
 */
import { Chip, Diagram, Edge, Label, Node, Note, SIZE, box } from "./kit"

/** self-hosting/index.mdx: the hosted app and the services behind it. */
export function ArchitectureDiagram() {
  const browser = box(0, 88, 88, SIZE.pair)
  const app = box(112, 88, 132, SIZE.pair)
  const busX = 268
  const col = 288
  const w = 184
  const notes = 488
  const yjs = box(col, 44, w, SIZE.row)
  const postgres = box(col, 96, w, SIZE.row)
  const sandbox = box(col, 148, w, 92)
  const model = box(col, 252, w, SIZE.row)
  const blob = box(col, 304, w, SIZE.row)
  const github = box(col, 356, w, SIZE.row)
  const sandboxRow = sandbox.y + SIZE.row / 2
  const services = [yjs, postgres, sandbox, model, blob, github]
  return (
    <Diagram
      width={672}
      height={400}
      label="The browser talks to the Next.js app, which uses Postgres, a Yjs host, a sandbox provider, model providers, a blob store and GitHub OAuth. The browser also syncs live with the Yjs host."
    >
      <Edge
        points={[browser.top, [browser.top[0], 20], [yjs.top[0], 20], yjs.top]}
        from
        dashed
      />
      <Label
        x={(browser.top[0] + yjs.top[0]) / 2}
        y={14}
        text="realtime"
        anchor="middle"
      />

      <Node b={browser} title="Browser" />
      <Edge points={[browser.right, app.left]} />
      <Node b={app} title="Next.js app" sub="Vercel" tone="hub" />

      <Edge points={[app.right, [busX, app.right[1]]]} to={false} />
      <Edge
        points={[
          [busX, yjs.left[1]],
          [busX, github.left[1]],
        ]}
        to={false}
      />
      {services.map((s) => {
        const y = s === sandbox ? sandboxRow : s.left[1]
        return <Edge key={y} points={[[busX, y], s.leftAt(y)]} />
      })}

      <Node b={yjs} title="Yjs host" />
      <Note x={notes} y={yjs.left[1]} text="live canvas state + presence" />
      <Node b={postgres} title="Postgres" />
      <Note
        x={notes}
        y={postgres.left[1]}
        text="users, canvases, chats, presets"
      />
      <Node b={sandbox} title="Sandbox provider" />
      <Note x={notes} y={sandboxRow} text="one VM per workspace" />
      <Chip b={box(col + 8, sandbox.y + 40, 80, 20)} text="dev server" />
      <Chip b={box(col + 96, sandbox.y + 40, 80, 20)} text="git" />
      <Chip b={box(col + 8, sandbox.y + 64, 80, 20)} text="terminals" />
      <Chip b={box(col + 96, sandbox.y + 64, 80, 20)} text="coding CLIs" />
      <Node b={model} title="Model provider(s)" />
      <Note x={notes} y={model.left[1]} text="the agent" />
      <Node b={blob} title="Blob store" />
      <Note x={notes} y={blob.left[1]} text="canvas thumbnails" />
      <Node b={github} title="GitHub OAuth" />
      <Note x={notes} y={github.left[1]} text="sign-in + repo access" />
    </Diagram>
  )
}

/** concepts.mdx: what a canvas holds. */
export function ConceptsDiagram() {
  const canvas = box(0, 0, 672, 328)
  const coordinator = box(16, 44, 640, SIZE.pair)
  const repo = box(16, 132, 328, 180)
  const workspace = box(32, 188, 288, SIZE.pair)
  const layersX = 360
  const frame = box(layersX, 188, 296, SIZE.pair)
  const doc = box(layersX, 256, 296, SIZE.pair)
  const handoffX = 296
  return (
    <Diagram
      width={672}
      height={328}
      label="A canvas has one Coordinator, which sends work to each workspace's agent. It also holds repositories, each with its workspaces, and layers: frames, which preview a workspace's dev server, and documents."
    >
      <Node b={canvas} title="Canvas" tone="group" heading />
      <Node
        b={coordinator}
        title="Coordinator"
        sub="the canvas's chat: sees everything, arranges the canvas"
      />
      <Node
        b={repo}
        title="Repository"
        sub="its code + how to run it"
        tone="group"
      />
      <Node
        b={workspace}
        title="Workspace"
        sub="a branch + its environment + its agent"
        tone="stack"
      />
      {/* Drawn after the repository region, whose fill would hide it. */}
      <Edge
        points={[
          [handoffX, coordinator.y + coordinator.h],
          [handoffX, workspace.y],
        ]}
      />
      <Label x={handoffX + 8} y={124} text="sends work" />
      <Note x={workspace.x} y={276} text="A repository can have many." />

      <Label x={layersX} y={156} text="Layers on the canvas" />
      <Node
        b={frame}
        title="Frame"
        sub="a live preview of a workspace's dev server"
      />
      <Node
        b={doc}
        title="Document"
        sub="a rich-text page the agent can read and write"
      />
      <Edge
        points={[frame.left, [workspace.right[0] + 8, frame.left[1]]]}
        dashed
      />
    </Diagram>
  )
}
