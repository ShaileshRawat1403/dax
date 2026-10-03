import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { CapabilityCatalog } from "@/capability/catalog"
import { CapabilityDescriptor } from "@/capability/capability-types"
import { CapabilityIdentityError } from "@/capability/dynamic-identity"
import { runSandboxedWorkerCheck } from "@/worker/worker-sandbox"
import { verifyWorkerPatch } from "@/worker/worker-verification"
import { Instance } from "@/project/instance"
import { runCheck } from "./check-runner"
import { CheckDefinition } from "./check-types"
import {
  bindVerificationCommand,
  listVerificationCommandCapabilities,
  requireVerificationCommandCapability,
} from "./verification-identity"

let root = ""

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "dax-verification-identity-"))
})

afterEach(async () => {
  await Instance.disposeAll()
  await fs.rm(root, { recursive: true, force: true })
})

function writer(marker: string) {
  return CheckDefinition.parse({
    id: "identity-probe",
    kind: "test",
    label: "identity probe",
    command: process.execPath,
    args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`],
    cwd: root,
    timeoutMs: 20_000,
  })
}

describe("verification command identity", () => {
  test("both runners have strict descriptors in the vocabulary and carry no grant", () => {
    const descriptors = listVerificationCommandCapabilities()
    expect(descriptors.map((item) => item.id)).toEqual([
      "verification.command.direct",
      "verification.command.sandboxed",
    ])
    const vocabulary = CapabilityCatalog.staticVocabulary()
    for (const descriptor of descriptors) {
      expect(descriptor).toMatchObject({ riskClass: "high", scopeSupport: "opaque", requiresVerification: false })
      expect(CapabilityDescriptor.safeParse({ ...descriptor, allowHosts: [] }).success).toBe(false)
      expect(vocabulary.require(descriptor.id)).toEqual(descriptor)
      expect(vocabulary.familyOf(descriptor.id)).toBe("verification_command")
    }
  })

  test("binding rejects malformed, forged, and changed checks", () => {
    const check = writer(path.join(root, "unused.txt"))
    const valid = { runner: "direct" as const, check, executor: runCheck }
    const binding = bindVerificationCommand(valid)
    expect(requireVerificationCommandCapability({ binding, ...valid }).id).toBe("verification.command.direct")
    expect(() => requireVerificationCommandCapability({ binding: {}, ...valid })).toThrow(CapabilityIdentityError)
    expect(() => requireVerificationCommandCapability({ binding, ...valid, runner: "sandboxed" })).toThrow(
      CapabilityIdentityError,
    )
    expect(() => requireVerificationCommandCapability({ binding, ...valid, executor: runSandboxedWorkerCheck })).toThrow(
      CapabilityIdentityError,
    )
    expect(() => requireVerificationCommandCapability({ binding, ...valid, check: { ...check } })).toThrow(
      CapabilityIdentityError,
    )
    check.args.push("--extra")
    expect(() => requireVerificationCommandCapability({ binding, ...valid })).toThrow(CapabilityIdentityError)
    expect(() => bindVerificationCommand({ ...valid, check: { ...check, command: "" } })).toThrow(
      CapabilityIdentityError,
    )
    expect(() => bindVerificationCommand({ ...valid, executor: {} })).toThrow(CapabilityIdentityError)
  })

  test("the real direct runner still executes a planned check", async () => {
    const marker = path.join(root, "direct-ran.txt")
    const result = await runCheck(writer(marker))
    expect(result.status).toBe("passed")
    expect(await Bun.file(marker).text()).toBe("ran")
  })

  test("production verification dispatch reaches the enrolled direct runner", async () => {
    const marker = path.join(root, "dispatch-ran.txt")
    await fs.writeFile(
      path.join(root, "check.js"),
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`,
    )
    // Verification reads the governing run's review state inside an instance, as the workflow runs it.
    const result = await Instance.provide({
      directory: root,
      fn: () => verifyWorkerPatch({ runId: "run_identity", cwd: root, commands: ["bun run check.js"] }),
    })
    expect(result.checks.map((check) => check.status)).toEqual(["passed"])
    expect(result.passed).toBe(true)
    expect(await Bun.file(marker).text()).toBe("ran")
  })

  test("an identity rejection in production dispatch blocks verification without running the check", async () => {
    const marker = path.join(root, "dispatch-ran.txt")
    await fs.writeFile(
      path.join(root, "check.js"),
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`,
    )
    const which = Bun.which
    const lookup = spyOn(Bun, "which").mockImplementation(((...args: Parameters<typeof Bun.which>) => {
      // Stands in for anything that alters the planned argv after binding.
      planned?.args.push("--changed-after-binding")
      return which(...args)
    }) as typeof Bun.which)
    let planned: CheckDefinition | undefined
    const run = async (check: CheckDefinition) => {
      planned = check
      return runCheck(check)
    }
    try {
      const result = await Instance.provide({
        directory: root,
        fn: () => verifyWorkerPatch({ runId: "run_identity", cwd: root, commands: ["bun run check.js"], run }),
      })
      expect(result.passed).toBe(false)
      expect(result.checks.map((check) => check.status)).toEqual(["error"])
      expect(result.checks[0].stderrPreview).toContain("Capability identity rejected: changed")
    } finally {
      lookup.mockRestore()
    }
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  test("a check changed after binding cannot reach the direct runner's process", async () => {
    const marker = path.join(root, "direct-ran.txt")
    const replaced = path.join(root, "replaced-ran.txt")
    const check = writer(marker)
    const which = Bun.which
    const lookup = spyOn(Bun, "which").mockImplementation(((...args: Parameters<typeof Bun.which>) => {
      check.args = ["-e", `require("node:fs").writeFileSync(${JSON.stringify(replaced)}, "ran")`]
      return which(...args)
    }) as typeof Bun.which)
    let reason: unknown
    try {
      await runCheck(check)
    } catch (error) {
      reason = error
    } finally {
      lookup.mockRestore()
    }
    expect(reason).toMatchObject({ code: "changed" })
    expect(await Bun.file(marker).exists()).toBe(false)
    expect(await Bun.file(replaced).exists()).toBe(false)
  })

  test("the real sandboxed runner accepts its own binding and reports a check result", async () => {
    const result = await runSandboxedWorkerCheck(writer(path.join(root, "sandboxed-ran.txt")))
    // The host may lack a sandbox provider; that is a check result, not an identity rejection.
    expect(result.id).toBe("identity-probe")
    expect(["passed", "failed", "error", "timed_out"]).toContain(result.status)
  })

  test("a malformed check is an identity rejection, not a recorded check result", async () => {
    const check = { ...writer(path.join(root, "unused.txt")), args: [1] } as unknown as CheckDefinition
    for (const run of [runCheck, runSandboxedWorkerCheck]) {
      let reason: unknown
      await run(check).catch((error) => {
        reason = error
      })
      expect(reason).toBeInstanceOf(CapabilityIdentityError)
    }
  })
})
