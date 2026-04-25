import Anthropic from "@anthropic-ai/sdk"
import { kv } from "@/lib/kv"
import { getSkillIndex, SKILLS_HASH } from "@/lib/skills"

let clientInstance: Anthropic | null = null

export function getClient(): Anthropic {
  if (!clientInstance) {
    clientInstance = new Anthropic()
  }
  return clientInstance
}

const AGENT_SYSTEM_PROMPT_BASE = `You are a skilled UI developer working inside a live development sandbox. You can read, write, and edit files, and run shell commands in the project.

When the user asks you to make changes:
1. First read relevant files to understand the current code
2. If the user's message starts with [plan mode: enabled], you MUST call submit_plan with a markdown plan before making ANY file changes. The plan should describe:
   - What files you will change and why
   - What specific changes you will make in each file
   - Any dependencies to install or commands to run
   Wait for the user to approve your plan before proceeding.
3. If plan mode is not enabled, skip planning and go straight to making changes.
4. Make precise, targeted edits
5. If needed, run commands to install dependencies or restart the dev server

When plan mode is enabled, you MUST call submit_plan and wait for approval before using write_file or edit_file. Do not skip this step.

CRITICAL — YOU MUST ALWAYS GIT COMMIT AND PUSH:
After ANY file change (write_file, edit_file), you MUST run all three of these commands before responding to the user. Never skip this step. Never forget. This is the most important rule.
   1. run_command with command "git" and args ["add", "-A"]
   2. run_command with command "git" and args ["commit", "-m", "<concise description of changes>"]
   3. run_command with command "git" and args ["push"]
If you do not push, the user will not see your changes. Always push.

IMPORTANT run_command rules:
- Do NOT chain commands with && or || — each command must be a separate run_command call.
- For commands with arguments that contain spaces (like commit messages), always use the "args" array parameter instead of putting everything in "command". For example: command="git", args=["commit", "-m", "fix button color to blue"].

Opening a pull request:
When the user asks to open, create, or submit a pull request (PR), call the create_pr tool. Generate a concise title from the changes on the branch and an optional short markdown body summarizing what changed. Do not use run_command with "gh pr create" — always use create_pr.`

const AGENT_SYSTEM_PROMPT_TAIL = `

The project is a Node.js app running on port 3000 with \`npm run dev\`. The preview updates automatically when you save files.

Keep your responses concise. Show the user what you changed and why.`

/**
 * Build the agent's system prompt with the live skill index baked in.
 * Each skill contributes its name + description so Claude can recognize when
 * one applies and call \`read_skill(name)\` to load the full instructions —
 * the same metadata-then-body progressive disclosure native Anthropic skills
 * use, just routed through our custom tool. Editing or adding a SKILL.md
 * automatically rolls the agent (see SKILLS_HASH).
 */
export function buildAgentSystemPrompt(): string {
  const skills = getSkillIndex()
  if (skills.length === 0) {
    return AGENT_SYSTEM_PROMPT_BASE + AGENT_SYSTEM_PROMPT_TAIL
  }
  const lines = [
    "",
    "",
    "Skills available:",
    "When a user request matches one of the skills below, call \`read_skill\` with the skill name to load its full instructions before making changes. Do not guess — read the skill first.",
    "",
    ...skills.map((s) => `- **${s.name}**: ${s.description}`),
  ]
  return AGENT_SYSTEM_PROMPT_BASE + lines.join("\n") + AGENT_SYSTEM_PROMPT_TAIL
}

/** Back-compat export — callers that imported the old constant get the live build. */
export const AGENT_SYSTEM_PROMPT: string = buildAgentSystemPrompt()

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
    name: "submit_plan",
    description:
      "Submit a plan for user approval before making any file changes. The plan should be written in markdown and describe what files will be changed, what changes will be made, and why. You MUST call this tool and wait for approval before using write_file or edit_file.",
    input_schema: {
      type: "object" as const,
      properties: {
        plan: {
          type: "string",
          description:
            "The plan in markdown format describing the proposed changes",
        },
      },
      required: ["plan"],
    },
  },
  {
    type: "custom",
    name: "create_pr",
    description:
      "Open a GitHub pull request from this agent's branch into the workspace's default branch. Call this when the user asks to create, open, or submit a PR. You should always provide a title generated from the recent changes. Optionally provide a markdown body summarizing what changed. Returns the PR URL and number.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description:
            "Concise PR title summarizing the change. Defaults to the branch name if omitted.",
        },
        body: {
          type: "string",
          description:
            "Optional markdown PR body summarizing the changes. Keep it short.",
        },
      },
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
  {
    type: "custom",
    name: "read_skill",
    description:
      "Load the full instructions for a skill listed in your skills index. Returns markdown — read it carefully before making changes. Use this whenever a user request matches a skill's description; do not guess at the implementation.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description:
            "The skill's name as listed in the skills index in your system prompt.",
        },
      },
      required: ["name"],
    },
  },
]

const AGENT_CACHE_KEY_PREFIX = "agent:screenplay:v4"

/**
 * Cache key includes the skills hash so editing a SKILL.md auto-rolls the
 * agent — the next request loads (or creates) an agent whose system prompt
 * matches the on-disk skill metadata.
 */
function agentCacheKey(model: string): string {
  return `${AGENT_CACHE_KEY_PREFIX}:${model}:${SKILLS_HASH}`
}
const ENV_CACHE_KEY = "agent:env:screenplay"

export const DEFAULT_AGENT_MODEL = "claude-sonnet-4-6"

export async function getOrCreateAgent(model: string = DEFAULT_AGENT_MODEL): Promise<string> {
  const cacheKey = agentCacheKey(model)
  const cached = await kv.get<string>(cacheKey)
  if (cached) return cached

  const client = getClient()
  const agent = await client.beta.agents.create({
    name: `Screenplay Editor (${model})`,
    model,
    system: buildAgentSystemPrompt(),
    tools: AGENT_TOOLS,
  })

  await kv.set(cacheKey, agent.id)
  return agent.id
}

export async function getOrCreateEnvironment(): Promise<string> {
  const cached = await kv.get<string>(ENV_CACHE_KEY)
  if (cached) return cached

  const client = getClient()
  const environment = await client.beta.environments.create({
    name: `screenplay-env-${Date.now()}`,
    config: {
      type: "cloud",
      networking: { type: "unrestricted" },
    },
  })

  await kv.set(ENV_CACHE_KEY, environment.id)
  return environment.id
}
