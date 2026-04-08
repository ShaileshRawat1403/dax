import { describe, expect, test } from "bun:test"
import { deriveRuntimeActionSemantics } from "./action-semantics"

describe("runtime action semantics", () => {
  test("uses explicit typed semantics for write actions", () => {
    const result = deriveRuntimeActionSemantics({
      toolID: "write",
      req: {
        permission: "edit",
        patterns: ["src/example.ts"],
        metadata: { filepath: "/tmp/src/example.ts" },
      },
    })

    expect(result.actionFamily).toBe("file_write")
    expect(result.governanceIntent).toBe("mutate")
    expect(result.actionClass).toBe("mutate")
    expect(result.typedSource).toBe("explicit")
  })

  test("uses derived typed semantics for whitelisted verification shell commands", () => {
    const result = deriveRuntimeActionSemantics({
      toolID: "shell",
      req: {
        permission: "shell",
        patterns: ["bun test packages/dax/test/determinism/runtime-hardening.test.ts"],
        metadata: {},
      },
    })

    expect(result.actionFamily).toBe("shell")
    expect(result.governanceIntent).toBe("verify")
    expect(result.actionClass).toBe("verify")
    expect(result.typedSource).toBe("derived")
    expect(result.commandSummary).toBe("bun test")
  })

  test("uses derived typed semantics for simple mutating shell commands", () => {
    const result = deriveRuntimeActionSemantics({
      toolID: "shell",
      req: {
        permission: "shell",
        patterns: ["mkdir tmp/scratch"],
        metadata: {},
      },
    })

    expect(result.actionFamily).toBe("shell")
    expect(result.governanceIntent).toBe("mutate")
    expect(result.actionClass).toBe("mutate")
    expect(result.typedSource).toBe("derived")
    expect(result.commandSummary).toBe("mkdir")
  })

  test("uses derived typed semantics for simple inspect shell commands", () => {
    const result = deriveRuntimeActionSemantics({
      toolID: "shell",
      req: {
        permission: "shell",
        patterns: ["git status --short"],
        metadata: {},
      },
    })

    expect(result.actionFamily).toBe("shell")
    expect(result.governanceIntent).toBe("inspect")
    expect(result.actionClass).toBe("analyze")
    expect(result.typedSource).toBe("derived")
    expect(result.commandSummary).toBe("git status")
  })

  test("uses derived typed semantics for simple commit shell commands", () => {
    const result = deriveRuntimeActionSemantics({
      toolID: "shell",
      req: {
        permission: "shell",
        patterns: ['git commit -m "release"'],
        metadata: {},
      },
    })

    expect(result.actionFamily).toBe("shell")
    expect(result.governanceIntent).toBe("commit")
    expect(result.actionClass).toBe("commit")
    expect(result.typedSource).toBe("derived")
    expect(result.commandSummary).toBe("git commit")
  })

  test("uses derived typed semantics for simple publish shell commands", () => {
    const result = deriveRuntimeActionSemantics({
      toolID: "shell",
      req: {
        permission: "shell",
        patterns: ["git push origin main"],
        metadata: {},
      },
    })

    expect(result.actionFamily).toBe("shell")
    expect(result.governanceIntent).toBe("publish")
    expect(result.actionClass).toBe("publish")
    expect(result.typedSource).toBe("derived")
    expect(result.commandSummary).toBe("git push")
  })

  test("falls back honestly for compound shell commands", () => {
    const result = deriveRuntimeActionSemantics({
      toolID: "shell",
      req: {
        permission: "shell",
        patterns: ["bun test && echo done"],
        metadata: {},
      },
    })

    expect(result.actionFamily).toBe("shell")
    expect(result.actionClass).toBe("verify")
    expect(result.typedSource).toBe("heuristic_fallback")
  })

  test("falls back honestly for compound commit-style shell commands", () => {
    const result = deriveRuntimeActionSemantics({
      toolID: "shell",
      req: {
        permission: "shell",
        patterns: ['git commit -m "release" && git push'],
        metadata: {},
      },
    })

    expect(result.actionClass).toBe("publish")
    expect(result.governanceIntent).toBe("publish")
    expect(result.typedSource).toBe("heuristic_fallback")
  })
})
