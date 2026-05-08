import "server-only"

import { getVercelSandboxProvider } from "@/lib/sandbox/vercel"
import type { SandboxProvider } from "@/lib/sandbox/types"

export type {
  SandboxCommandResult,
  SandboxCreateOptions,
  SandboxFile,
  SandboxGetOptions,
  SandboxGitSource,
  SandboxInstance,
  SandboxNetworkPolicy,
  SandboxNetworkPolicyRule,
  SandboxProvider,
  SandboxRunCommandOptions,
  SandboxSnapshotSource,
  SandboxSource,
} from "@/lib/sandbox/types"

/**
 * The configured sandbox provider singleton. Today this is always Vercel
 * Sandbox; making it an env-switched factory is a one-line change once a
 * second implementation lands (E2B, Modal, a local Docker driver, etc.).
 */
export const sandboxProvider: SandboxProvider = getVercelSandboxProvider()
