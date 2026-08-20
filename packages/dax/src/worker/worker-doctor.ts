import { ExternalWorkerId, WORKER_PROFILES } from "@/worker/worker-adapter"
import { buildEgressAllowlist } from "@/worker/egress-allowlist"
import { checkWorkerSandbox, type WorkerSandboxCheck } from "@/worker/worker-sandbox"

/**
 * `dax worker doctor` — readiness diagnostics for governed external workers.
 *
 * Readiness is a property of WORKER_PROFILES, never a per-worker doctor
 * function. A worker is described by the same declared data that builds its
 * invocation: binary, auth lane, required env, denied selectors, state dirs,
 * egress hosts. This module reads those declarations and reports against them,
 * so adding a provider adds a doctor check for free — there is no
 * doctorGemini()/doctorAntigravity()/doctorClaude() split to keep in sync.
 *
 * Invariants (locked):
 * - never prints or partially prints credential values
 * - no network request just to run doctor
 * - no mutation (no checkout, no state dirs created)
 * - no automatic login
 * - no worker execution (only `--version` probes the binary; nothing that
 *   edits a checkout or talks to a provider API)
 * - exit 0 when every checked worker is ready, non-zero otherwise
 */

export type WorkerCheckStatus = "ok" | "missing" | "blocked"

export type WorkerReadinessItem = {
  label: string
  status: WorkerCheckStatus
  value: string
}

export type WorkerReadinessReport = {
  workerId: ExternalWorkerId
  label: string
  binary: string
  authLane: string
  items: WorkerReadinessItem[]
  ready: boolean
  next: string[]
}

export type WorkerDoctorInput = {
  workerId: ExternalWorkerId
  hostEnv?: Record<string, string | undefined>
  which?: (binary: string) => string | null
  checkSandbox?: () => WorkerSandboxCheck
}

function whichBinary(binary: string): string | null {
  const found = Bun.which(binary)
  return found ?? null
}

/**
 * Probe the binary version without touching a provider API or a checkout.
 * A missing or slow binary still reports the binary itself as present —
 * the version is diagnostic color, never a readiness gate.
 */
export async function probeBinaryVersion(binary: string, which = whichBinary): Promise<string | undefined> {
  const path = which(binary)
  if (!path) return undefined
  try {
    const result = Bun.spawnSync([path, "--version"], { stdout: "pipe", stderr: "pipe" })
    if (result.exitCode !== 0) return undefined
    const line = result.stdout.toString().trim().split("\n")[0]
    return line || undefined
  } catch {
    return undefined
  }
}

export async function workerReadiness(input: WorkerDoctorInput): Promise<WorkerReadinessReport> {
  const profile = WORKER_PROFILES[input.workerId]
  const hostEnv = input.hostEnv ?? process.env
  const which = input.which ?? whichBinary
  const checkSandbox = input.checkSandbox ?? checkWorkerSandbox
  const items: WorkerReadinessItem[] = []
  const next: string[] = []

  const binaryPath = which(profile.binary)
  const version = binaryPath ? await probeBinaryVersion(profile.binary, which) : undefined
  items.push({
    label: "Binary",
    status: binaryPath ? "ok" : "missing",
    value: binaryPath ? `${profile.binary} ${version ?? ""}`.trim() : profile.binary,
  })
  if (!binaryPath) {
    next.push(`Install ${profile.binary} and put it on PATH, then rerun \`dax worker doctor ${input.workerId}\`.`)
  }

  // Auth lane: required env vars declared by the profile. Values are never
  // shown — only presence or absence.
  const missingEnv = (profile.requiredEnv ?? []).filter((name) => !hostEnv[name])
  items.push({
    label: "Auth",
    status: missingEnv.length === 0 ? "ok" : "missing",
    value:
      missingEnv.length === 0
        ? profile.requiredEnv && profile.requiredEnv.length > 0
          ? profile.requiredEnv.join(", ")
          : "none required (stored auth)"
        : `missing ${missingEnv.join(", ")}`,
  })
  if (missingEnv.length > 0) {
    next.push(`Set ${missingEnv.join(" and ")} in the environment, then rerun \`dax worker doctor ${input.workerId}\`.`)
  }
  items.push({ label: "Auth lane", status: "ok", value: profile.authLane })

  // Conflicting auth selectors the profile denies. The worker may carry none
  // (no ambient Google auth vars are set), or DAX strips them at build time.
  // Presence in the host env is not an error — the deny-list neutralizes it —
  // so this reports the neutralization, not a failure.
  const deniedPresent = (profile.denyEnv ?? []).filter((name) => Boolean(hostEnv[name]))
  items.push({
    label: "Conflicts",
    status: "ok",
    value:
      (profile.denyEnv?.length ?? 0) === 0
        ? "none declared"
        : deniedPresent.length > 0
          ? `${deniedPresent.join(", ")} present but blocked by profile`
          : `${(profile.denyEnv ?? []).join(", ")} blocked by profile`,
  })

  // Isolation: the worker's state roots. Run-scoped roots (GEMINI_CLI_HOME)
  // are injected per run; home-relative roots are the CLI's own config dirs.
  const stateDirs = profile.stateDirs(hostEnv, {
    task: "",
    writeScope: [],
    forbiddenPaths: [],
    verification: [],
    runId: "<doctor>",
  })
  const injected = profile.injectEnv?.(
    { task: "", writeScope: [], forbiddenPaths: [], verification: [], runId: "<doctor>" },
    hostEnv,
  )
  const home = hostEnv.HOME
  const stateValue = stateDirs
    .map((dir) => (home && dir.startsWith(home) ? `~${dir.slice(home.length)}` : dir))
    .join(", ")
  items.push({
    label: "State",
    status: stateDirs.length > 0 ? "ok" : "blocked",
    value:
      injected && Object.keys(injected).length > 0
        ? `isolated per-run (${Object.entries(injected).map(([k]) => k).join(", ")})`
        : stateValue,
  })

  const sandbox = checkSandbox()
  items.push({
    label: "Sandbox",
    status: sandbox.available ? "ok" : "blocked",
    value: sandbox.available ? sandbox.summary : sandbox.reason,
  })
  if (!sandbox.available) next.push(sandbox.remedy)

  const egressHosts = [...buildEgressAllowlist({ workerId: input.workerId, hostEnv })]
  items.push({
    label: "Egress",
    status: egressHosts.length > 0 ? "ok" : "blocked",
    value:
      egressHosts.length > 0
        ? `allowlist: ${egressHosts.join(", ")}`
        : "no egress hosts configured",
  })
  if (egressHosts.length === 0) {
    next.push(`No egress hosts are configured for ${input.workerId}; add them in the worker profile.`)
  }

  const ready = items.every((item) => item.status === "ok")
  return {
    workerId: input.workerId,
    label: profile.label,
    binary: profile.binary,
    authLane: profile.authLane,
    items,
    ready,
    next,
  }
}

export async function allWorkerReadiness(
  input: Omit<WorkerDoctorInput, "workerId"> = {},
): Promise<WorkerReadinessReport[]> {
  return Promise.all(ExternalWorkerId.options.map((workerId) => workerReadiness({ ...input, workerId })))
}

/** Render one worker's readiness report. Never touches credential values. */
export function formatWorkerReadiness(report: WorkerReadinessReport): string {
  const lines: string[] = []
  const width = Math.max(...report.items.map((item) => item.label.length)) + 2
  for (const item of report.items) {
    const mark = item.status === "ok" ? "✓" : item.status === "missing" ? "✗" : "✗"
    lines.push(`${item.label.padEnd(width)}${mark} ${item.value}`)
  }
  lines.push(`Status${"".padEnd(width - 6 + 2)}${report.ready ? "READY" : "NOT READY"}`)
  return lines.join("\n")
}