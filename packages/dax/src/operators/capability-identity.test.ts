import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CapabilityIdentityError } from "@/capability/dynamic-identity"
import { createTaskGraph, addTask } from "@/planner/task-graph"
import type { Operator } from "./base"
import { GitOperator } from "./git"
import { OperatorRouter, createInitializedRouter } from "./router"
import { listBuiltinOperatorCapabilities } from "./capability-identity"
import { runGraph } from "@/execution/run-graph"
import { Instance } from "@/project/instance"

const temporary: string[] = []
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function task(type: string, action?: unknown) {
  const graph = createTaskGraph("operator-capability-test")
  addTask(graph, {
    id: "first",
    name: "First",
    description: "Controlled graph dispatch",
    operator_type: type,
    dependencies: [],
    context: action === undefined ? {} : { action },
  })
  return graph
}

function dispatch(graph: ReturnType<typeof task>, router: OperatorRouter, cwd: string = process.cwd()) {
  return Instance.provide({
    directory: cwd,
    fn: () => runGraph(graph, { cwd, sessionId: "graph-operator-test" }, router),
  })
}

describe("built-in graph operator identity", () => {
  test("describes each known executor and each Git action without granting authority", () => {
    const descriptors = listBuiltinOperatorCapabilities()
    expect(descriptors.map((item) => item.id)).toEqual([
      "operator.explore.run",
      "operator.git.add",
      "operator.git.commit",
      "operator.git.push",
      "operator.git.checkout",
      "operator.git.status",
      "operator.verify.report",
      "operator.release.report",
      "operator.artifact.report",
    ])
    for (const descriptor of descriptors) {
      expect(descriptor.riskClass).toBe("high")
      expect(descriptor.scopeSupport).toBe("opaque")
      expect(descriptor.requiresVerification).toBe(true)
      expect(Object.isFrozen(descriptor)).toBe(true)
      expect("grant" in descriptor).toBe(false)
    }
    expect(createInitializedRouter().getOperator("git")).toBeInstanceOf(GitOperator)
  })

  test("runs the actual registered Git status executor through graph dispatch", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dax-operator-capability-"))
    temporary.push(directory)
    execFileSync("git", ["init", "-q"], { cwd: directory })
    const graph = task("git", "status")
    const result = await dispatch(graph, createInitializedRouter(), directory)
    expect(result.success).toBe(true)
    expect(graph.tasks.get("first")?.status).toBe("completed")
    expect(graph.tasks.get("first")?.result).toMatchObject({ action: "status", operator: "git" })
  })

  test("rejects a foreign executor using a built-in name before publication", () => {
    let effects = 0
    const router = new OperatorRouter()
    expect(() => router.register({
      type: "git",
      async execute() {
        effects++
        return { success: true, output: {} }
      },
    })).toThrow(CapabilityIdentityError)
    expect(router.getOperator("git")).toBeUndefined()
    expect(effects).toBe(0)
  })

  test("prototype copies and proxies do not inherit a built-in identity", () => {
    const copied = Object.assign(Object.create(GitOperator.prototype) as Operator, { type: "git" })
    const proxy = new Proxy(new GitOperator(), {})
    const router = new OperatorRouter()
    expect(() => router.register(copied)).toThrow("Capability identity rejected: changed")
    expect(() => router.register(proxy)).toThrow("Capability identity rejected: changed")
    expect(router.getOperator("git")).toBeUndefined()
  })

  test("a replaced built-in prototype method cannot be enrolled", () => {
    const original = GitOperator.prototype.execute
    let effects = 0
    try {
      GitOperator.prototype.execute = async () => {
        effects++
        return { success: true, output: {} }
      }
      const router = new OperatorRouter()
      expect(() => router.register(new GitOperator())).toThrow("Capability identity rejected: changed")
      expect(router.getOperator("git")).toBeUndefined()
      expect(effects).toBe(0)
    } finally {
      GitOperator.prototype.execute = original
    }
  })

  test("duplicate registration rejects without replacing the selected executor", () => {
    const router = new OperatorRouter()
    const selected = new GitOperator()
    router.register(selected)
    expect(() => router.register(new GitOperator())).toThrow("Capability identity rejected: ambiguous")
    expect(router.getOperator("git")).toBe(selected)
  })

  test("a changing custom type cannot transfer its registration to a built-in name", async () => {
    let typeReads = 0
    let effects = 0
    const custom: Operator = {
      get type() {
        return ++typeReads === 1 ? "custom" : "git"
      },
      async execute() {
        effects++
        return { success: true, output: {} }
      },
    }
    const router = new OperatorRouter()
    router.register(custom)
    expect(router.getOperator("git")).toBeUndefined()
    const graph = task("custom")
    const result = await dispatch(graph, router)
    expect(result.success).toBe(false)
    expect(graph.tasks.get("first")?.error?.message).toBe("Capability identity rejected: changed")
    expect(effects).toBe(0)
  })

  test("changed executor is rejected by real graph dispatch before its effect", async () => {
    const router = new OperatorRouter()
    const selected = new GitOperator()
    router.register(selected)
    let effects = 0
    selected.execute = async () => {
      effects++
      return { success: true, output: {} }
    }
    const graph = task("git", "status")
    const result = await dispatch(graph, router)
    expect(result.success).toBe(false)
    expect(result.failedTasks).toEqual(["first"])
    expect(graph.tasks.get("first")?.error?.message).toBe("Capability identity rejected: changed")
    expect(effects).toBe(0)
  })

  test("an unknown Git action rejects before the selected executor runs", async () => {
    const router = new OperatorRouter()
    const selected = new GitOperator()
    router.register(selected)
    const graph = task("git", "unspecified-remote-effect")
    const result = await dispatch(graph, router)
    expect(result.success).toBe(false)
    expect(graph.tasks.get("first")?.error?.message).toBe("Capability identity rejected: malformed")
  })

  test("a dynamic Git action getter cannot change the selected action", async () => {
    const router = new OperatorRouter()
    router.register(new GitOperator())
    const graph = task("git")
    let actionReads = 0
    Object.defineProperty(graph.tasks.get("first")!.context, "action", {
      get() {
        actionReads++
        return actionReads === 1 ? "status" : "push"
      },
    })
    const result = await dispatch(graph, router)
    expect(result.success).toBe(false)
    expect(graph.tasks.get("first")?.error?.message).toBe("Capability identity rejected: malformed")
    expect(actionReads).toBe(0)
  })

  test("an inherited Git action cannot differ from the selected default", async () => {
    const router = new OperatorRouter()
    router.register(new GitOperator())
    const graph = task("git")
    Object.setPrototypeOf(graph.tasks.get("first")!.context, { action: "push" })
    const result = await dispatch(graph, router)
    expect(result.success).toBe(false)
    expect(graph.tasks.get("first")?.error?.message).toBe("Capability identity rejected: malformed")
  })

  test("action changes after lookup cannot reuse the previous binding", async () => {
    const router = new OperatorRouter()
    const selected = new GitOperator()
    router.register(selected)
    const graph = task("git", "status")
    const planned = graph.tasks.get("first")!
    const invocation = router.execution(planned, selected)
    expect(invocation.capability?.id).toBe("operator.git.status")
    planned.context.action = "push"
    expect(() => invocation.execute({ cwd: process.cwd(), sessionId: "changed-action" }))
      .toThrow("Capability identity rejected: changed")
  })

  test("legacy custom operator retains dispatch with a conservative descriptor", async () => {
    let effects = 0
    const custom: Operator = {
      type: "custom",
      async execute() {
        effects++
        return { success: true, output: { okay: true } }
      },
    }
    const router = new OperatorRouter()
    router.register(custom)
    const graph = task("custom")
    expect(router.execution(graph.tasks.get("first")!, custom).capability).toMatchObject({
      riskClass: "high", scopeSupport: "opaque", requiresVerification: true,
    })
    const result = await dispatch(graph, router)
    expect(result.success).toBe(true)
    expect(effects).toBe(1)
  })
  test("a custom operator mutated after selection is refused before effects", async () => {
    let effects = 0
    const custom: Operator = { type: "custom", execute: async () => { effects++; return { success: true, output: {} } } }
    const router = new OperatorRouter()
    router.register(custom)
    const selected = router.execution(task("custom").tasks.get("first")!, custom)
    custom.execute = async () => { effects++; return { success: true, output: {} } }
    expect(() => selected.execute({ cwd: process.cwd(), sessionId: "custom-changed" })).toThrow(CapabilityIdentityError)
    expect(effects).toBe(0)
  })

  test("malformed custom registration publishes no operator", () => {
    const router = new OperatorRouter()
    expect(() => router.register({ type: "bad\uD800", execute: async () => ({ success: true, output: {} }) })).toThrow(CapabilityIdentityError)
    expect(router.getOperator("bad\uD800")).toBeUndefined()
  })

})
