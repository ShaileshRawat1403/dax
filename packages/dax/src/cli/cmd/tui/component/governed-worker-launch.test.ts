import { describe, expect, test } from "bun:test"
import {
  buildGovernedWorkerRunRequest,
  createGovernedWorkerRun,
  governedWorkerOptions,
  parseWorkerScope,
  renderGovernedWorkerPreview,
} from "./governed-worker-launch"

const input = {
  workerId: "antigravity" as const,
  task: "Update the bounded documentation example",
  repoPath: "/repo/project",
  writeScope: ["docs/**"],
  verification: ["bun test"],
  sessionId: "session_parent",
}

describe("governed worker TUI launch", () => {
  test("presents Antigravity as the recommended worker and Gemini CLI as enterprise legacy", () => {
    const options = governedWorkerOptions()
    expect(options[0]).toMatchObject({ id: "antigravity", binary: "agy", recommended: true })
    expect(options.find((option) => option.id === "gemini")?.title).toContain("enterprise legacy")
    expect(options.find((option) => option.id === "gemini")?.description).toContain("individual accounts use Antigravity")
  })

  test("parses an explicit bounded scope without widening it", () => {
    expect(parseWorkerScope("docs/**, packages/dax/src/**\ndocs/**")).toEqual([
      "docs/**",
      "packages/dax/src/**",
    ])
  })

  test("builds the existing canonical worker_run request with filtered egress", () => {
    expect(buildGovernedWorkerRunRequest(input)).toEqual({
      intent: { input: input.task, kind: "workflow_step", repoPath: input.repoPath },
      workflowHint: "worker_run",
      personaPreset: { personaId: "governed-worker", providerHint: "worker:antigravity" },
      workerConstraints: {
        writeScope: ["docs/**"],
        forbiddenPaths: [],
        verification: ["bun test"],
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
        sessionId: "session_parent",
        targeting: { mode: "explicit_repo_path", repoPath: input.repoPath },
      },
    })
  })

  test("fails closed on missing scope, unsafe verification, or a relative repository", () => {
    expect(() => buildGovernedWorkerRunRequest({ ...input, writeScope: [] })).toThrow("write scope")
    expect(() => buildGovernedWorkerRunRequest({ ...input, verification: ["rm -rf ."] })).toThrow("not approved")
    expect(() => buildGovernedWorkerRunRequest({ ...input, repoPath: "relative" })).toThrow("absolute")
  })

  test("preview exposes the exact authority boundary before launch", () => {
    const preview = renderGovernedWorkerPreview(input)
    expect(preview).toContain("Antigravity CLI")
    expect(preview).toContain("docs/**")
    expect(preview).toContain("bun test")
    expect(preview).toContain("antigravity-unleash.goog")
    expect(preview).toContain("canonical approval")
  })

  test("rejects a server response that did not preserve worker_run semantics", async () => {
    await expect(
      createGovernedWorkerRun(input, async () => ({
        runId: "run_1",
        status: "created",
        createdAt: new Date(0).toISOString(),
        workflowClass: "generic",
      })),
    ).rejects.toThrow("did not resolve to worker_run")
  })

  test("accepts only a worker_run response after passing the canonical request to the server", async () => {
    let providerHint: string | undefined
    const result = await createGovernedWorkerRun(input, async (request) => {
      providerHint = request.personaPreset?.providerHint
      return {
        runId: "run_agy_1",
        status: "running",
        createdAt: new Date(0).toISOString(),
        workflowClass: "worker_run",
      }
    })
    expect(providerHint).toBe("worker:antigravity")
    expect(result).toMatchObject({ runId: "run_agy_1", workflowClass: "worker_run" })
  })
})
