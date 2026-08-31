import { isAbsolute } from "node:path"
import type { CreateRunRequest, CreateRunResponse } from "@/server/run-contract"
import { isWhitelistedVerificationCommand } from "@/tool/shell-whitelist"
import { buildEgressAllowlist } from "@/worker/egress-allowlist"
import { ExternalWorkerId, workerBinary, type ExternalWorkerId as WorkerId } from "@/worker/worker-adapter"

export type GovernedWorkerLaunchInput = {
  workerId: WorkerId
  task: string
  repoPath: string
  writeScope: string[]
  verification: string[]
  sessionId?: string
}

export type GovernedWorkerOption = {
  id: WorkerId
  title: string
  description: string
  recommended: boolean
  binary: string
}

const WORKER_COPY: Record<WorkerId, Omit<GovernedWorkerOption, "id" | "binary">> = {
  antigravity: {
    title: "Antigravity CLI",
    description: "Google AI subscription worker via local agy; DAX governs execution",
    recommended: true,
  },
  claude: {
    title: "Claude Code",
    description: "Anthropic coding worker via local claude CLI",
    recommended: false,
  },
  codex: {
    title: "Codex CLI",
    description: "OpenAI coding worker via local codex CLI",
    recommended: false,
  },
  gemini: {
    title: "Gemini CLI (enterprise legacy)",
    description: "Supported enterprise/API-key deployments only; individual accounts use Antigravity",
    recommended: false,
  },
}

export function governedWorkerOptions(): GovernedWorkerOption[] {
  return ["antigravity", "claude", "codex", "gemini"].map((value) => {
    const id = ExternalWorkerId.parse(value)
    return { id, binary: workerBinary(id), ...WORKER_COPY[id] }
  })
}

export function parseWorkerScope(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))]
}

export function buildGovernedWorkerRunRequest(input: GovernedWorkerLaunchInput): CreateRunRequest {
  const workerId = ExternalWorkerId.parse(input.workerId)
  const task = input.task.trim()
  const repoPath = input.repoPath.trim()
  const writeScope = [...new Set(input.writeScope.map((item) => item.trim()).filter(Boolean))]
  const verification = [...new Set(input.verification.map((item) => item.trim()).filter(Boolean))]

  if (!task) throw new Error("A worker task is required.")
  if (!isAbsolute(repoPath)) throw new Error("The governed repository path must be absolute.")
  if (writeScope.length === 0) throw new Error("At least one explicit write scope is required.")
  if (verification.length === 0) throw new Error("At least one DAX-approved verification command is required.")
  const unsafe = verification.find((command) => !isWhitelistedVerificationCommand(command))
  if (unsafe) throw new Error(`Verification command is not approved by DAX: ${unsafe}`)

  return {
    intent: { input: task, kind: "workflow_step", repoPath },
    workflowHint: "worker_run",
    personaPreset: { personaId: "governed-worker", providerHint: `worker:${workerId}` },
    workerConstraints: {
      writeScope,
      forbiddenPaths: [],
      verification,
      provenance: {
        writeScope: "operator-authored",
        forbiddenPaths: "operator-confirmed",
        verification: "operator-authored",
      },
      egress: { filter: true, allowHosts: [] },
    },
    metadata: {
      source: "dax",
      initiatedBy: "tui-worker-launcher",
      sessionId: input.sessionId,
      targeting: { mode: "explicit_repo_path", repoPath },
    },
  }
}

export function renderGovernedWorkerPreview(input: GovernedWorkerLaunchInput): string {
  const option = governedWorkerOptions().find((candidate) => candidate.id === input.workerId)!
  const hosts = [...buildEgressAllowlist({ workerId: input.workerId })]
  return [
    `Worker: ${option.title}`,
    `Repository: ${input.repoPath}`,
    `Task: ${input.task.trim()}`,
    `Write scope: ${input.writeScope.join(", ")}`,
    "Forbidden paths: none explicitly added; write scope remains the outer boundary",
    `Verification: ${input.verification.join(", ")}`,
    `Egress: ${hosts.join(", ")} (exact-host proxy)`,
    `Host requirement: ${option.binary} plus DAX-supported OS isolation; checked when execution starts`,
    "Execution: disposable checkout; DAX observes the diff and requires canonical approval",
  ].join("\n")
}

export async function createGovernedWorkerRun(
  input: GovernedWorkerLaunchInput,
  create: (request: CreateRunRequest) => Promise<CreateRunResponse>,
): Promise<CreateRunResponse> {
  const result = await create(buildGovernedWorkerRunRequest(input))
  if (result.workflowClass !== "worker_run") {
    throw new Error(
      `Run ${result.runId} did not resolve to worker_run (${result.workflowClass ?? "unknown"}). ${result.warnings?.join("; ") ?? ""}`.trim(),
    )
  }
  return result
}
