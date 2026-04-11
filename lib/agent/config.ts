import Anthropic from "@anthropic-ai/sdk"
import { Redis } from "@upstash/redis"

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

let clientInstance: Anthropic | null = null

export function getClient(): Anthropic {
  if (!clientInstance) {
    clientInstance = new Anthropic()
  }
  return clientInstance
}

export const AGENT_SYSTEM_PROMPT = `You are a skilled UI developer working inside a live development sandbox. You can read, write, and edit files, and run shell commands in the project.

When the user asks you to make changes:
1. First read relevant files to understand the current code
2. Make precise, targeted edits
3. If needed, run commands to install dependencies or restart the dev server
4. IMPORTANT: After making any file changes, always commit and push your changes:
   - Run: git add -A
   - Run: git commit -m "<concise description of changes>"
   - Run: git push origin HEAD
   This ensures all changes are saved to the remote branch.

The project is a Node.js app running on port 3000 with \`npm run dev\`. The preview updates automatically when you save files.

Keep your responses concise. Show the user what you changed and why.`

export const AGENT_TOOLS: Anthropic.Beta.Agents.AgentCreateParams["tools"] = [
  {
    type: "agent_toolset_20260401",
    default_config: { enabled: false },
  },
  {
    type: "custom",
    name: "read_file",
    description:
      "Read the contents of a file from the project. Returns the full file content as text. Use this to understand existing code before making changes.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Path to the file relative to the project root, e.g. 'src/App.tsx'",
        },
      },
      required: ["path"],
    },
  },
  {
    type: "custom",
    name: "write_file",
    description:
      "Write content to a file, creating it if it doesn't exist or replacing it entirely. Use this for new files or complete rewrites.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to the project root",
        },
        content: {
          type: "string",
          description: "The full content to write to the file",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    type: "custom",
    name: "edit_file",
    description:
      "Perform a find-and-replace edit in a file. The old_string must match exactly (including whitespace and indentation). Use this for targeted changes to existing files.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to the project root",
        },
        old_string: {
          type: "string",
          description: "The exact string to find in the file",
        },
        new_string: {
          type: "string",
          description: "The string to replace it with",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    type: "custom",
    name: "run_command",
    description:
      "Run a shell command in the project directory. Returns stdout, stderr, and exit code. Use for installing packages, running scripts, checking status, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "The command to execute, e.g. 'npm install axios'",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Optional arguments to pass to the command",
        },
      },
      required: ["command"],
    },
  },
  {
    type: "custom",
    name: "list_files",
    description:
      "List files in the project directory. Returns file paths, useful for understanding project structure.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Directory path relative to the project root. Defaults to '.' (project root)",
        },
        pattern: {
          type: "string",
          description:
            "Optional glob-like filter pattern, e.g. '*.tsx' to list only TypeScript files",
        },
      },
    },
  },
]

const AGENT_CACHE_KEY = "agent:screenplay"
const ENV_CACHE_KEY = "agent:env:screenplay"

export async function getOrCreateAgent(): Promise<string> {
  const cached = await redis.get<string>(AGENT_CACHE_KEY)
  if (cached) return cached

  const client = getClient()
  const agent = await client.beta.agents.create({
    name: "Screenplay Editor",
    model: "claude-sonnet-4-6",
    system: AGENT_SYSTEM_PROMPT,
    tools: AGENT_TOOLS,
  })

  await redis.set(AGENT_CACHE_KEY, agent.id)
  return agent.id
}

export async function getOrCreateEnvironment(): Promise<string> {
  const cached = await redis.get<string>(ENV_CACHE_KEY)
  if (cached) return cached

  const client = getClient()
  const environment = await client.beta.environments.create({
    name: `screenplay-env-${Date.now()}`,
    config: {
      type: "cloud",
      networking: { type: "unrestricted" },
    },
  })

  await redis.set(ENV_CACHE_KEY, environment.id)
  return environment.id
}
