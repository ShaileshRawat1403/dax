import z from "zod"
import { join } from "node:path"
import { buildEgressAllowlist } from "./egress-allowlist"

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
 * - network: external workers must reach their provider APIs, so the sandbox
 *   runs with network "full" (writes remain checkout-confined). Egress is then
 *   narrowed by a forward proxy to the provider host allowlist (see
 *   egress-allowlist.ts). That confinement is cooperative — it binds a worker
 *   that honors the injected proxy env, not one that opens a raw socket — so
 *   the invocation carries the intended policy and the run records what
 *   actually held.
 */

export const ExternalWorkerId = z.enum(["claude", "codex", "gemini"])
export type ExternalWorkerId = z.infer<typeof ExternalWorkerId>

/**
 * Egress confinement decided for an invocation. "filtered" carries the exact
 * host allowlist the run's forward proxy will enforce; "unconfined" is the
 * operator escape hatch (--no-egress-filter) and is recorded as such in the
 * receipt so an unfiltered run is never mistaken for a filtered one.
 */
export type WorkerEgressPolicy =
  | { mode: "filtered"; allowHosts: string[] }
  | { mode: "unconfined" }

export const WorkerProviderKind = z.enum(["external_cli", "native", "remote"])
export type WorkerProviderKind = z.infer<typeof WorkerProviderKind>

/**
 * What DAX knows about an approved provider.
 *
 * Deliberately descriptive, not contractual. A `capabilities` list and a
 * `requiresIsolatedCheckout` flag used to live here; both were written
 * identically by every provider and read by nothing, so they promised a
 * negotiation that does not happen. Isolation is not per-provider: the
 * worker_run workflow always creates a disposable checkout and always computes
 * the diff itself, for every provider, and that is what makes the guarantee
 * rather than a boolean anyone could set to false.
 *
 * Reintroduce capability declarations when a provider appears that genuinely
 * cannot do what another can, and enforce them at the same time.
 */
export type WorkerProviderDescriptor = {
  id: string
  label: string
  kind: WorkerProviderKind
}

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
  /** Provider identity recorded with the invocation and later evidence. */
  providerId: string
  /**
   * Legacy external-CLI identity. Retained while existing workflow effects
   * and consumers migrate to providerId; native/remote providers omit it.
   */
  workerId?: ExternalWorkerId
  /** argv, first element is the binary. */
  command: string[]
  /** Allowlist-filtered environment (plus contract metadata). */
  env: Record<string, string>
  /** Sandbox network policy for this worker. */
  network: "full" | "localhost-only" | "none"
  /** Egress confinement the run's forward proxy applies over that network. */
  egress: WorkerEgressPolicy
  /**
   * Worker-owned state dirs (e.g. ~/.codex) the sandbox must let the CLI write
   * at init. Not the repo: repo writes stay confined to the checkout and the
   * diff is computed only from there. Absent/empty for providers that need no
   * home-dir state.
   */
  writableStatePaths: string[]
  timeoutMs: number
}

/** Operator input that shapes egress confinement for an invocation. */
export type WorkerEgressInput = {
  /** Whether to run the egress allowlist proxy. Defaults on. */
  filter?: boolean
  /** Extra hosts the operator permits beyond the provider defaults. */
  allowHosts?: readonly string[]
}

/**
 * A DAX worker provider is an invocation adapter, never a second run
 * authority. Native and remote providers will implement this same boundary;
 * Flowright continues to see only DAX's capability receipt.
 */
export interface WorkerProvider {
  descriptor: WorkerProviderDescriptor
  buildInvocation(input: {
    contract: WorkerContract
    hostEnv: Record<string, string | undefined>
    timeoutMs?: number
    egress?: WorkerEgressInput
  }): WorkerInvocation
}

/**
 * Local registry for DAX-owned adapters. It intentionally has no dynamic
 * plugin loading yet: adding a provider is reviewed code plus contract tests,
 * not an untrusted configuration toggle.
 */
export class WorkerProviderRegistry {
  private readonly providers = new Map<string, WorkerProvider>()

  register(provider: WorkerProvider): this {
    const id = provider.descriptor.id.trim()
    if (!id) throw new Error("worker provider id is required")
    if (this.providers.has(id)) throw new Error(`worker provider '${id}' is already registered`)
    this.providers.set(id, provider)
    return this
  }

  get(id: string): WorkerProvider | undefined {
    return this.providers.get(id)
  }

  list(): WorkerProviderDescriptor[] {
    return [...this.providers.values()].map((provider) => provider.descriptor)
  }
}

type WorkerProfile = {
  label: string
  binary: string
  /** Build argv given the rendered contract prompt. */
  args: (prompt: string) => string[]
  /** Env var names passed through from the host environment. */
  envAllowlist: string[]
  /**
   * Absolute state dirs the CLI must be able to write at init (its own config,
   * session, and app-server socket live here — the sandbox fails the worker
   * closed without them). Derived from the host env so a custom home is
   * honored. Not the repo; repo writes stay checkout-confined.
   */
  stateDirs: (hostEnv: Record<string, string | undefined>) => string[]
}

/**
 * Resolve worker state dirs to absolute paths, dropping anything non-absolute
 * (a missing HOME must not turn into a bogus relative allow). Deduped.
 */
function homeStateDirs(
  hostEnv: Record<string, string | undefined>,
  homeRelative: string[],
  explicit: (string | undefined)[] = [],
): string[] {
  const home = hostEnv.HOME
  const fromHome = home ? homeRelative.map((name) => join(home, name)) : []
  const all = [...explicit, ...fromHome].filter(
    (path): path is string => typeof path === "string" && path.startsWith("/"),
  )
  return [...new Set(all)]
}

/**
 * Non-interactive invocation profiles. CLI flags drift as these tools
 * evolve; profiles are data so an update is a one-line change covered by
 * tests, not an architecture change. Verify against each tool's docs when
 * bumping.
 */
const WORKER_PROFILES: Record<ExternalWorkerId, WorkerProfile> = {
  claude: {
    label: "Claude Code",
    binary: "claude",
    // acceptEdits: headless claude denies write tools by default (no human
    // to answer its prompts). Inside DAX's disposable checkout with DAX's
    // approval gate downstream, Claude's own interactive gate is a redundant
    // double gate — file edits flow, the kernel diff and human review remain
    // the authority. Deliberately NOT --dangerously-skip-permissions.
    args: (prompt) => ["-p", prompt, "--output-format", "text", "--permission-mode", "acceptEdits"],
    envAllowlist: ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_OAUTH_TOKEN"],
    stateDirs: (hostEnv) => homeStateDirs(hostEnv, [".claude"]),
  },
  codex: {
    label: "Codex",
    binary: "codex",
    // DAX is the sandbox and the approval authority here. The worker already runs
    // inside DAX's Seatbelt/bubblewrap profile (writes confined to the checkout,
    // secrets masked, egress filtered) and its diff is reviewed at DAX's human
    // gate. Codex's own `--sandbox workspace-write` adds a nested sandbox on top
    // of DAX's; empirically that nesting (and worktree-root mis-detection) makes
    // codex apply nothing — a governed run produced an empty diff while the same
    // command run raw applied the edit. Bypassing codex's inner gates lets it
    // write; DAX's outer isolation still bounds it to the checkout. This mirrors
    // the claude `acceptEdits` choice above: the worker's own gate is a redundant
    // double gate under DAX governance.
    args: (prompt) => ["exec", "--dangerously-bypass-approvals-and-sandbox", prompt],
    envAllowlist: ["OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_HOME"],
    // Codex writes runtime state (session + in-process app-server socket) here
    // at init and fails closed without write access. Verified on macOS Seatbelt:
    // ~/.codex is the necessary-and-sufficient writable subpath. CODEX_HOME wins
    // when set.
    stateDirs: (hostEnv) => homeStateDirs(hostEnv, [".codex"], [hostEnv.CODEX_HOME]),
  },
  gemini: {
    label: "Gemini CLI",
    binary: "gemini",
    args: (prompt) => ["-p", prompt],
    envAllowlist: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT"],
    stateDirs: (hostEnv) => homeStateDirs(hostEnv, [".gemini"]),
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
  egress?: WorkerEgressInput
}): WorkerInvocation {
  return buildProviderInvocation({
    providerId: ExternalWorkerId.parse(input.workerId),
    contract: input.contract,
    hostEnv: input.hostEnv,
    timeoutMs: input.timeoutMs,
    egress: input.egress,
  })
}

/** Build an invocation through a registered provider adapter. */
export function buildProviderInvocation(input: {
  providerId: string
  contract: WorkerContract
  hostEnv?: Record<string, string | undefined>
  timeoutMs?: number
  registry?: WorkerProviderRegistry
  egress?: WorkerEgressInput
}): WorkerInvocation {
  const contract = WorkerContract.parse(input.contract)
  const provider = (input.registry ?? DefaultWorkerProviderRegistry).get(input.providerId)
  if (!provider) throw new Error(`unknown worker provider '${input.providerId}'`)
  return provider.buildInvocation({
    contract,
    hostEnv: input.hostEnv ?? {},
    timeoutMs: input.timeoutMs,
    egress: input.egress,
  })
}

function createExternalCliWorkerProvider(workerId: ExternalWorkerId): WorkerProvider {
  const profile = WORKER_PROFILES[workerId]
  return {
    descriptor: {
      id: workerId,
      label: profile.label,
      kind: "external_cli",
    },
    buildInvocation({ contract, hostEnv, timeoutMs, egress }) {
      const prompt = renderWorkerPrompt(contract)
      // Egress filtering is on unless the operator opted out. The allowlist is
      // provider defaults plus any custom base-URL host plus operator extras.
      const filterEnabled = egress?.filter ?? true
      const egressPolicy: WorkerEgressPolicy = filterEnabled
        ? {
            mode: "filtered",
            allowHosts: [...buildEgressAllowlist({ workerId, hostEnv, allowHosts: egress?.allowHosts })],
          }
        : { mode: "unconfined" }
      return {
        providerId: workerId,
        workerId,
        command: [profile.binary, ...profile.args(prompt)],
        env: buildWorkerEnv(workerId, hostEnv, contract),
        // External workers must reach their provider APIs. The workflow wraps
        // this invocation in the platform sandbox before execution; egress
        // within that network is narrowed to the allowlist above by the proxy.
        network: "full",
        egress: egressPolicy,
        // The CLI's own state dir must be writable at init (verified on
        // Seatbelt). Repo writes stay checkout-confined regardless.
        writableStatePaths: profile.stateDirs(hostEnv),
        timeoutMs: timeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS,
      }
    },
  }
}

/**
 * Current production adapters. A future DAX Native provider must register
 * here only after it can execute inside the same checkout, verification, and
 * receipt path. A UI label is not proof of a governed worker.
 */
export const DefaultWorkerProviderRegistry = new WorkerProviderRegistry()
for (const workerId of ExternalWorkerId.options) {
  DefaultWorkerProviderRegistry.register(createExternalCliWorkerProvider(workerId))
}
