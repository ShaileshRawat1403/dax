import { describe, expect, test } from "bun:test"
import {
  DEFAULT_WORKER_TIMEOUT_MS,
  DefaultWorkerProviderRegistry,
  ExternalWorkerId,
  WORKER_PROFILES,
  WorkerContract,
  WorkerProviderRegistry,
  buildWorkerEnv,
  buildWorkerInvocation,
  buildProviderInvocation,
  renderWorkerPrompt,
} from "./worker-adapter"

const contract: WorkerContract = WorkerContract.parse({
  task: "Add an isEven helper to src/math.ts with tests.",
  writeScope: ["src/**", "test/**"],
  forbiddenPaths: [".github/**", "package.json"],
  verification: ["bun test"],
  runId: "run_worker_1",
  invocationId: "inv_worker_1",
})

describe("worker adapter", () => {
  test("each worker gets a non-interactive invocation carrying the contract prompt", () => {
    for (const workerId of ExternalWorkerId.options) {
      const invocation = buildWorkerInvocation({ workerId, contract })
      expect(invocation.providerId).toBe(workerId)
      // providerId is the durable id recorded in the event log; the binary is
      // a vendor detail that drifts (gemini -> agy). Assert the profile binary,
      // not the id.
      expect(invocation.command[0]).toBe(WORKER_PROFILES[workerId].binary)
      const prompt = invocation.command.find((arg) => arg.includes("TASK:"))
      expect(prompt).toBeDefined()
      expect(prompt).toContain("Add an isEven helper")
      expect(prompt).toContain("src/**")
      expect(prompt).toContain("Never touch: .github/**")
      expect(prompt).toContain("bun test")
    }
  })

  test("the contract prompt states governance honestly (kernel authority, human review)", () => {
    const prompt = renderWorkerPrompt(contract)
    expect(prompt).toContain("DAX computes the authoritative diff")
    expect(prompt).toContain("human approval")
    expect(prompt).toContain("Do not commit, push")
  })

  test("env passthrough is allowlist-only — worker credentials in, nothing else", () => {
    const hostEnv = {
      ANTHROPIC_API_KEY: "sk-ant-xxx",
      OPENAI_API_KEY: "sk-oai-xxx",
      GEMINI_API_KEY: "gm-xxx",
      AWS_SECRET_ACCESS_KEY: "leak-me-not",
      HOME: "/Users/operator",
      USER: "operator",
      LOGNAME: "operator",
      TMPDIR: "/tmp/operator",
      GITHUB_TOKEN: "ghp-leak-me-not",
    }
    const claudeEnv = buildWorkerEnv("claude", hostEnv, contract)
    expect(claudeEnv.ANTHROPIC_API_KEY).toBe("sk-ant-xxx")
    expect(claudeEnv.OPENAI_API_KEY).toBeUndefined()
    expect(claudeEnv.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(claudeEnv.GITHUB_TOKEN).toBeUndefined()

    const codexEnv = buildWorkerEnv("codex", hostEnv, contract)
    expect(codexEnv.OPENAI_API_KEY).toBe("sk-oai-xxx")
    expect(codexEnv.ANTHROPIC_API_KEY).toBeUndefined()
  })

  test("base session identity (HOME/USER/LOGNAME/TMPDIR) passes through for all workers", () => {
    const hostEnv = {
      HOME: "/Users/operator",
      USER: "operator",
      LOGNAME: "operator",
      TMPDIR: "/tmp/operator",
      AWS_SECRET_ACCESS_KEY: "never",
      GITHUB_TOKEN: "never",
    }
    for (const workerId of ExternalWorkerId.options) {
      const env = buildWorkerEnv(workerId, hostEnv, contract)
      expect(env.HOME).toBe("/Users/operator")
      expect(env.USER).toBe("operator")
      expect(env.LOGNAME).toBe("operator")
      expect(env.TMPDIR).toBe("/tmp/operator")
      expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
      expect(env.GITHUB_TOKEN).toBeUndefined()
    }
  })

  test("contract metadata rides the env for worker-side traceability", () => {
    const env = buildWorkerEnv("gemini", {}, contract)
    expect(env.DAX_RUN_ID).toBe("run_worker_1")
    expect(env.DAX_INVOCATION_ID).toBe("inv_worker_1")
    expect(env.DAX_GOVERNED_WORKER).toBe("1")
  })

  test("network is full for provider APIs while workflow confinement owns writes", () => {
    const invocation = buildWorkerInvocation({ workerId: "claude", contract })
    expect(invocation.network).toBe("full")
    expect(invocation.timeoutMs).toBe(DEFAULT_WORKER_TIMEOUT_MS)
  })

  test("codex worker bypasses its own nested sandbox so DAX's isolation is the single authority", () => {
    // DAX already wraps the worker in its own sandbox + approval gate; codex's
    // own `--sandbox workspace-write` nests a second sandbox that empirically
    // makes it apply nothing. The worker runs under DAX's isolation instead.
    const invocation = buildWorkerInvocation({ workerId: "codex", contract })
    expect(invocation.command).toContain("exec")
    expect(invocation.command).toContain("--dangerously-bypass-approvals-and-sandbox")
    expect(invocation.command).not.toContain("workspace-write")
  })

  test("claude worker gets headless edit permission without skipping all gates", () => {
    const invocation = buildWorkerInvocation({ workerId: "claude", contract })
    expect(invocation.command).toContain("--permission-mode")
    expect(invocation.command).toContain("acceptEdits")
    expect(invocation.command).not.toContain("--dangerously-skip-permissions")
  })

  test("unknown workers and empty tasks are rejected", () => {
    expect(() => buildWorkerInvocation({ workerId: "copilot" as ExternalWorkerId, contract })).toThrow()
    expect(() => WorkerContract.parse({ ...contract, task: "" })).toThrow()
  })

  test("the default registry lists every approved provider as an external CLI", () => {
    const providers = DefaultWorkerProviderRegistry.list()
    expect(providers.map((provider) => provider.id)).toEqual(["claude", "codex", "gemini", "antigravity"])
    for (const provider of providers) {
      expect(provider.kind).toBe("external_cli")
    }
  })

  test("provider lookup fails closed and duplicate registration is rejected", () => {
    expect(() => buildProviderInvocation({ providerId: "unknown", contract })).toThrow("unknown worker provider")

    const registry = new WorkerProviderRegistry()
    const provider = DefaultWorkerProviderRegistry.get("claude")
    expect(provider).toBeDefined()
    registry.register(provider!)
    expect(() => registry.register(provider!)).toThrow("already registered")
  })
})
