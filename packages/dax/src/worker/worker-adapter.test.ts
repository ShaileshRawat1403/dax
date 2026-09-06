import { describe, expect, test } from "bun:test"
import path from "node:path"
import {
  DEFAULT_WORKER_TIMEOUT_MS,
  DefaultWorkerProviderRegistry,
  ExternalWorkerId,
  WorkerContract,
  WorkerProviderRegistry,
  assertWorkerBinaryAvailable,
  buildWorkerEnv,
  buildWorkerInvocation,
  buildProviderInvocation,
  renderWorkerPrompt,
  validateWorkerProcessOutput,
} from "./worker-adapter"

const contract: WorkerContract = WorkerContract.parse({
  task: "Add an isEven helper to src/math.ts with tests.",
  writeScope: ["src/**", "test/**"],
  forbiddenPaths: [".github/**", "package.json"],
  verification: ["bun test"],
  runId: "run_worker_1",
  invocationId: "inv_worker_1",
})
const workingDirectory = "/repo/checkout"

describe("worker adapter", () => {
  test("each worker gets a non-interactive invocation carrying the contract prompt", () => {
    for (const workerId of ExternalWorkerId.options) {
      const invocation = buildWorkerInvocation({ workerId, contract, workingDirectory })
      expect(invocation.providerId).toBe(workerId)
      expect(invocation.command[0]).toBe(workerId === "antigravity" ? "agy" : workerId)
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
    const invocation = buildWorkerInvocation({ workerId: "claude", contract, workingDirectory })
    expect(invocation.network).toBe("full")
    expect(invocation.timeoutMs).toBe(DEFAULT_WORKER_TIMEOUT_MS)
  })

  test("codex worker bypasses its own nested sandbox so DAX's isolation is the single authority", () => {
    // DAX already wraps the worker in its own sandbox + approval gate; codex's
    // own `--sandbox workspace-write` nests a second sandbox that empirically
    // makes it apply nothing. The worker runs under DAX's isolation instead.
    const invocation = buildWorkerInvocation({ workerId: "codex", contract, workingDirectory })
    expect(invocation.command).toContain("exec")
    expect(invocation.command).toContain("--dangerously-bypass-approvals-and-sandbox")
    expect(invocation.command).not.toContain("workspace-write")
  })

  test("claude worker gets headless edit permission without skipping all gates", () => {
    const invocation = buildWorkerInvocation({ workerId: "claude", contract, workingDirectory })
    expect(invocation.command).toContain("--permission-mode")
    expect(invocation.command).toContain("acceptEdits")
    expect(invocation.command).not.toContain("--dangerously-skip-permissions")
  })

  test("antigravity uses the explicit AGY headless contract and narrow state/env boundary", () => {
    const invocation = buildWorkerInvocation({
      workerId: "antigravity",
      contract,
      workingDirectory,
      hostEnv: {
        HOME: "/Users/operator",
        USER: "operator",
        XPC_FLAGS: "0x0",
        XPC_SERVICE_NAME: "0",
        AWS_SECRET_ACCESS_KEY: "never",
      },
      timeoutMs: 42_500,
    })

    expect(invocation.command).toEqual([
      "agy",
      "-p",
      expect.stringContaining("TASK:"),
      "--new-project",
      "--add-dir",
      workingDirectory,
      "--mode",
      "accept-edits",
      "--output-format",
      "json",
      "--print-timeout",
      "43s",
    ])
    expect(invocation.command).not.toContain("--dangerously-skip-permissions")
    expect(invocation.writableStatePaths).toEqual([path.join("/Users/operator", ".gemini/antigravity-cli")])
    expect(invocation.env.XPC_FLAGS).toBe("0x0")
    expect(invocation.env.XPC_SERVICE_NAME).toBe("0")
    expect(invocation.env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
  })

  test("antigravity accepts only valid SUCCESS terminal JSON", () => {
    const invocation = buildWorkerInvocation({ workerId: "antigravity", contract, workingDirectory })
    const success = JSON.stringify({
      conversation_id: "conversation_1",
      status: "SUCCESS",
      response: "done\n",
      duration_seconds: 1.2,
      num_turns: 1,
      usage: { input_tokens: 10, output_tokens: 2, thinking_tokens: 1, cache_read_tokens: 0, total_tokens: 12 },
    })
    expect(() => validateWorkerProcessOutput(invocation, { exitCode: 0, stdout: success, stderr: "" })).not.toThrow()

    for (const status of ["ERROR", "CANCELED", "INTERRUPTED", "INVALID", "WAITING", "RUNNING"] as const) {
      const output = JSON.stringify({
        conversation_id: "",
        status,
        response: "",
        error: "not complete",
        duration_seconds: 0,
        num_turns: 0,
        usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 },
      })
      expect(() => validateWorkerProcessOutput(invocation, { exitCode: status === "ERROR" ? 1 : 0, stdout: output, stderr: "" })).toThrow(status)
    }
    expect(() => validateWorkerProcessOutput(invocation, { exitCode: 0, stdout: "not-json", stderr: "" })).toThrow("invalid headless JSON")
    expect(() => validateWorkerProcessOutput(invocation, { exitCode: 0, stdout: JSON.stringify({ status: "SUCCESS" }), stderr: "" })).toThrow("malformed")
  })

  test("missing antigravity binary fails with an actionable install message", () => {
    const invocation = buildWorkerInvocation({ workerId: "antigravity", contract, workingDirectory })
    expect(() => assertWorkerBinaryAvailable(invocation, () => null)).toThrow("antigravity.google/docs/cli/install")
  })

  test("unknown workers and empty tasks are rejected", () => {
    expect(() =>
      buildWorkerInvocation({ workerId: "copilot" as ExternalWorkerId, contract, workingDirectory }),
    ).toThrow()
    expect(() => WorkerContract.parse({ ...contract, task: "" })).toThrow()
    expect(() =>
      buildWorkerInvocation({ workerId: "antigravity", contract, workingDirectory: "relative/checkout" }),
    ).toThrow("absolute path")
  })

  test("the default registry lists every approved provider as an external CLI", () => {
    const providers = DefaultWorkerProviderRegistry.list()
    expect(providers.map((provider) => provider.id)).toEqual(["claude", "codex", "gemini", "antigravity"])
    for (const provider of providers) {
      expect(provider.kind).toBe("external_cli")
    }
  })

  test("provider lookup fails closed and duplicate registration is rejected", () => {
    expect(() => buildProviderInvocation({ providerId: "unknown", contract, workingDirectory })).toThrow(
      "unknown worker provider",
    )

    const registry = new WorkerProviderRegistry()
    const provider = DefaultWorkerProviderRegistry.get("claude")
    expect(provider).toBeDefined()
    registry.register(provider!)
    expect(() => registry.register(provider!)).toThrow("already registered")
  })
})
