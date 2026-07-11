import z from "zod"

/**
 * External worker adapters — the BYOA layer (docs/dax/byoa-strategy.md).
 *
 * DAX governs external coding agents (Claude Code, Codex CLI, Gemini CLI)
 * as capability workers: DAX owns the worktree, the sandbox, the diff, the
 * approval gate, and the receipt; the worker is a replaceable execution
 * engine invoked non-interactively inside DAX's contract.
 *
 * This module is deliberately pure: it builds the invocation (argv, env,
 * network policy, contract prompt) and interprets nothing. Execution,
 * diffing, approval, and evidence stay with the run machinery.
 *
 * Trust rules encoded here:
 * - env is allowlist-only: every worker gets the shared BASE_ENV_ALLOWLIST
 *   (session identity — HOME, USER, LOGNAME, TMPDIR — needed to resolve
 *   keychain/OAuth tokens) plus its own credential vars, and nothing else
 *   from the operator's environment. Identity ≠ secrets: the credential
 *   boundary remains per-worker.
 * - the contract prompt states write scope, forbidden operations, and
 *   verification expectations in plain language; enforcement does NOT rely
 *   on the worker honoring it — the kernel-computed diff and path guards
 *   remain the authority. The prompt reduces waste, not risk.
 * - network: external workers must reach their provider APIs, so v0 runs
 *   with sandbox network "full" (filesystem still confined). Per-host
 *   proxy allowlists are the documented hardening step; the field exists
 *   so the tightening is a config change, not a redesign.
 */

export const ExternalWorkerId = z.enum(["claude", "codex", "gemini"])
export type ExternalWorkerId = z.infer<typeof ExternalWorkerId>

export const WorkerContract = z.object({
  task: z.string().min(1),
  /** Globs the worker is expected to confine writes to (kernel-enforced). */
  writeScope: z.array(z.string()).default([]),
  /** Paths the worker must not touch (kernel-enforced; stated for economy). */
  forbiddenPaths: z.array(z.string()).default([]),
  /** Commands DAX will run to verify the result (worker never self-grades). */
  verification: z.array(z.string()).default([]),
  runId: z.string(),
  invocationId: z.string().optional(),
})
export type WorkerContract = z.infer<typeof WorkerContract>

export type WorkerInvocation = {
  workerId: ExternalWorkerId
  /** argv, first element is the binary. */
  command: string[]
  /** Allowlist-filtered environment (plus contract metadata). */
  env: Record<string, string>
  /** Sandbox network policy for this worker. */
  network: "full" | "localhost-only" | "none"
  timeoutMs: number
}

type WorkerProfile = {
  binary: string
  /** Build argv given the rendered contract prompt. */
  args: (prompt: string) => string[]
  /** Env var names passed through from the host environment. */
  envAllowlist: string[]
}

/**
 * Non-interactive invocation profiles. CLI flags drift as these tools
 * evolve; profiles are data so an update is a one-line change covered by
 * tests, not an architecture change. Verify against each tool's docs when
 * bumping.
 */
const WORKER_PROFILES: Record<ExternalWorkerId, WorkerProfile> = {
  claude: {
    binary: "claude",
    // acceptEdits: headless claude denies write tools by default (no human
    // to answer its prompts). Inside DAX's disposable checkout with DAX's
    // approval gate downstream, Claude's own interactive gate is a redundant
    // double gate — file edits flow, the kernel diff and human review remain
    // the authority. Deliberately NOT --dangerously-skip-permissions.
    args: (prompt) => ["-p", prompt, "--output-format", "text", "--permission-mode", "acceptEdits"],
    envAllowlist: ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_OAUTH_TOKEN"],
  },
  codex: {
    binary: "codex",
    args: (prompt) => ["exec", "--sandbox", "workspace-write", prompt],
    envAllowlist: ["OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_HOME"],
  },
  gemini: {
    binary: "gemini",
    args: (prompt) => ["-p", prompt],
    envAllowlist: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT"],
  },
}

export const DEFAULT_WORKER_TIMEOUT_MS = 15 * 60 * 1000

/** Session identity every worker needs to resolve its own auth/config.
 *  Identity, not secrets — the credential boundary stays per-worker. */
const BASE_ENV_ALLOWLIST = ["HOME", "USER", "LOGNAME", "TMPDIR"]

/**
 * The execution contract, rendered as the worker's prompt envelope. Plain
 * language, no tool-specific syntax — every worker gets the same contract.
 */
export function renderWorkerPrompt(contract: WorkerContract): string {
  const lines: string[] = [
    "You are running as a governed worker inside a DAX-managed checkout.",
    "DAX computes the authoritative diff of your work, requires human approval before anything is applied, and records evidence. Work accordingly:",
    "",
  ]
  if (contract.writeScope.length > 0) {
    lines.push(`- Only modify files matching: ${contract.writeScope.join(", ")}`)
  }
  if (contract.forbiddenPaths.length > 0) {
    lines.push(`- Never touch: ${contract.forbiddenPaths.join(", ")}`)
  }
  if (contract.verification.length > 0) {
    lines.push(`- Your work will be verified with: ${contract.verification.join(" && ")} — make it pass.`)
  }
  lines.push(
    "- Do not commit, push, install global tools, or modify anything outside this checkout.",
    "- Prefer minimal, reviewable changes; a human reads your diff before it lands.",
    "",
    "TASK:",
    contract.task,
  )
  return lines.join("\n")
}

/** Allowlist-only env passthrough: session identity + worker credentials in, nothing else. */
export function buildWorkerEnv(
  workerId: ExternalWorkerId,
  hostEnv: Record<string, string | undefined>,
  contract: WorkerContract,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const name of [...BASE_ENV_ALLOWLIST, ...WORKER_PROFILES[workerId].envAllowlist]) {
    const value = hostEnv[name]
    if (value) env[name] = value
  }
  env.DAX_RUN_ID = contract.runId
  if (contract.invocationId) env.DAX_INVOCATION_ID = contract.invocationId
  env.DAX_GOVERNED_WORKER = "1"
  return env
}

export function buildWorkerInvocation(input: {
  workerId: ExternalWorkerId
  contract: WorkerContract
  hostEnv?: Record<string, string | undefined>
  timeoutMs?: number
}): WorkerInvocation {
  const workerId = ExternalWorkerId.parse(input.workerId)
  const contract = WorkerContract.parse(input.contract)
  const profile = WORKER_PROFILES[workerId]
  const prompt = renderWorkerPrompt(contract)

  return {
    workerId,
    command: [profile.binary, ...profile.args(prompt)],
    env: buildWorkerEnv(workerId, input.hostEnv ?? {}, contract),
    // External workers must reach their provider APIs. Filesystem stays
    // sandbox-confined; per-host egress allowlisting is the hardening step.
    network: "full",
    timeoutMs: input.timeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS,
  }
}
