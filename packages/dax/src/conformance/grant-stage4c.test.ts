import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { GrantReview } from "@/capability/grant-review"
import {
  CapabilityActionDeniedError,
  recordActionResolution,
  type RecordedAction,
} from "@/capability/record-resolution"
import { nativeCapabilities } from "@/capability/registry"
import { Config } from "@/config/config"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian } from "@/execution/contract-guardian"
import { GrantReviewBarrierError } from "@/execution/grant-review-barrier"
import { createGrantReviewedRun } from "@/execution/run-factory"
import { mcpReadDescriptor } from "@/mcp/resource-identity"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { authorizeOperatorShell, OperatorShellDeniedError } from "@/session/operator-shell-authority"
import { appendEventOnly, createEventAuthorityRun, resolveApprovalEvent } from "@/state/events/event-transitions"
import { projectRunStateFromEvents, readRunEvents } from "@/state/events/run-event-store"
import { Storage } from "@/storage/storage"

/**
 * Grant stage 4c, first slice: action paths in an activated reviewed run are
 * decided, not shadowed. The published contract and the journal's activation
 * decide before any effect, the enforced resolution is written first, and a
 * failed write denies. Every other run keeps the isolated record-only path.
 *
 * A source run binds no native or session capability, so here every action is
 * denied; the allow side is shown by a compiled probe of the same decision.
 */

let home: string
let directory: string
let previousHome: string | undefined

beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "dax-grant-stage4c-")))
  process.env.DAX_TEST_HOME = home
  directory = path.join(home, "project")
  await fs.mkdir(directory, { recursive: true })
  await fs.mkdir(path.join(home, ".config", "dax"), { recursive: true })
  expect(Bun.spawnSync(["git", "init", "--quiet", directory]).exitCode).toBe(0)
  await fs.writeFile(
    path.join(home, ".config", "dax", "dax.json"),
    JSON.stringify({ mcp: { gamma: { type: "remote", url: "http://127.0.0.1:9/reviewed", enabled: false } } }),
  )
  await Instance.disposeAll()
  Config.global.reset()
})
afterEach(async () => {
  await Instance.disposeAll()
  Config.global.reset()
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  await fs.rm(home, { recursive: true, force: true })
})

const within = <T>(fn: () => Promise<T>) => Instance.provide({ directory, fn })

function rejection(work: Promise<unknown>) {
  return work.then(
    () => undefined,
    (error: unknown) => error,
  )
}

async function subjectOf(runId: string, approvalId: string) {
  return (await readRunEvents(runId))
    .filter((event) => event.type === "approval_requested")
    .map((event) => event.payload as { approvalId: string; contractGrantSubject?: unknown })
    .find((payload) => payload.approvalId === approvalId)!.contractGrantSubject
}

/** Reviewed with the remote server's tool and resource sources acknowledged, approved, published and, by default, activated. */
async function reviewed(activate = true) {
  const { runId, revision } = await createGrantReviewedRun(
    { request: { intent: { input: "Inspect the repository, read only." } }, availableTools: ["read"] },
    {
      acknowledgedExternal: ["mcp_source:resource:gamma"],
      sourceSelections: [{ server: "gamma", family: "resource" }],
    },
  )
  await resolveApprovalEvent(runId, revision.approvalId, "approved", "operator")
  await GrantReview.publish(runId, {
    approvalId: revision.approvalId,
    subject: await subjectOf(runId, revision.approvalId),
  })
  if (activate) await GrantReview.activate(runId)
  return runId
}

const actions = (runId: string): RecordedAction[] => [
  {
    governedBy: { sessionID: runId },
    subject: "template_reference",
    path: "template_reference",
    initiator: "operator",
    executor: {
      kind: "builtin",
      descriptor: {
        id: "session.context.template.stat",
        riskClass: "low",
        scopeSupport: "filesystem",
        requiresVerification: false,
      },
    },
    target: { paths: [path.join(directory, "README.md")] },
  },
  {
    governedBy: { sessionID: runId },
    subject: "context_attachment",
    path: "context_attachment",
    initiator: "operator",
    executor: {
      kind: "builtin",
      alias: "read",
      descriptor: {
        id: "session.context.attachment.read",
        riskClass: "low",
        scopeSupport: "filesystem",
        requiresVerification: false,
      },
    },
    target: { paths: [path.join(directory, "README.md")] },
  },
  {
    governedBy: { sessionID: runId },
    subject: "command_shell",
    path: "command_shell",
    initiator: "operator",
    executor: {
      kind: "builtin",
      alias: "shell",
      descriptor: {
        id: "session.command.shell",
        riskClass: "high",
        scopeSupport: "opaque",
        requiresVerification: true,
      },
    },
  },
  {
    governedBy: { runId },
    subject: "workflow",
    path: "workflow",
    initiator: "system",
    executor: {
      kind: "builtin",
      descriptor: {
        id: "workflow.generic.execute",
        riskClass: "high",
        scopeSupport: "opaque",
        requiresVerification: true,
      },
    },
  },
]

const enforced = async (runId: string) =>
  ((await projectRunStateFromEvents(runId))?.capabilityResolutions ?? []).filter(
    (item) => item.enforcement === "enforced",
  )

describe("action paths in an activated reviewed run are decided before any effect", () => {
  test("each action without a grant is denied, recorded as enforced, citing the activation", async () => {
    await within(async () => {
      const runId = await reviewed()
      const activation = (await projectRunStateFromEvents(runId))!.grantReview.activated!
      // The shell alias is outside this read-only contract's tool lists; the rest have no grant.
      const expected = ["grant_absent", "grant_absent", "contract_tool_denied", "grant_absent"]
      for (const [index, action] of actions(runId).entries()) {
        const error = await rejection(recordActionResolution(action))
        expect(error).toBeInstanceOf(CapabilityActionDeniedError)
        expect((error as CapabilityActionDeniedError).reasonCode).toBe(expected[index]!)
      }
      const records = await enforced(runId)
      expect(records.map((item) => item.path)).toEqual([
        "template_reference",
        "context_attachment",
        "command_shell",
        "workflow",
      ])
      for (const [index, record] of records.entries()) {
        expect(record).toMatchObject({
          decision: "deny",
          reasonCode: ["grant_absent", "grant_absent", "contract_tool_denied", "grant_absent"][index],
          activation: { revision: activation.revision, contractDigest: activation.contractDigest },
        })
      }
    })
  })

  test("an MCP resource read under its acknowledged source grant is still denied: its source cannot be proven", async () => {
    await within(async () => {
      const runId = await reviewed()
      const error = await rejection(
        recordActionResolution({
          governedBy: { sessionID: runId },
          subject: "mcp_resource",
          path: "mcp_resource",
          initiator: "operator",
          executor: { kind: "mcp", descriptor: mcpReadDescriptor("resource", "gamma", "file:///notes") },
          source: { server: "gamma", name: "file:///notes" },
        }),
      )
      expect(error).toBeInstanceOf(CapabilityActionDeniedError)
      expect((error as CapabilityActionDeniedError).reasonCode).toBe("source_unproven")
      // Nothing about the item name reaches the journal.
      expect(JSON.stringify(await readRunEvents(runId))).not.toContain("file:///notes")
    })
  })

  test("an enforced resolution that cannot be written denies the action", async () => {
    await within(async () => {
      const runId = await reviewed()
      const original = Storage.write
      const write = spyOn(Storage, "write").mockImplementation((async (key: string[], value: unknown) => {
        if (
          key[0] === "run_events" &&
          Array.isArray(value) &&
          (value.at(-1) as { type?: string } | undefined)?.type === "capability_resolution_recorded"
        ) {
          throw new Error("injected resolution write failure")
        }
        return original(key, value)
      }) as typeof Storage.write)
      let error: unknown
      try {
        error = await rejection(recordActionResolution(actions(runId)[2]!))
      } finally {
        write.mockRestore()
      }
      expect(error).toBeInstanceOf(CapabilityActionDeniedError)
      expect((error as CapabilityActionDeniedError).reasonCode).toBe("resolution_unrecorded")
      expect(await enforced(runId)).toEqual([])
    })
  })

  test("the operator's shell is decided the same way, and a run that is not activated meets the barrier", async () => {
    await within(async () => {
      const runId = await reviewed()
      const capability = nativeCapabilities.list().find((item) => item.id === "session.shell.operator") ?? {
        id: "session.shell.operator",
        riskClass: "high",
        scopeSupport: "opaque",
        requiresVerification: true,
      }
      const denied = await rejection(
        authorizeOperatorShell({ sessionID: runId, agent: "build", command: "true", callID: "call_4c", capability }),
      )
      expect(denied).toBeInstanceOf(OperatorShellDeniedError)
      // The operator's shell is decided under the contract's tool lists like any shell.
      expect((denied as OperatorShellDeniedError).reasonCode).toBe("grant:contract_tool_denied")

      const pending = await reviewed(false)
      expect(
        await rejection(
          authorizeOperatorShell({
            sessionID: pending,
            agent: "build",
            command: "true",
            callID: "call_4c_p",
            capability,
          }),
        ),
      ).toBeInstanceOf(GrantReviewBarrierError)
      for (const action of actions(pending)) {
        expect(await rejection(recordActionResolution(action))).toBeInstanceOf(GrantReviewBarrierError)
      }
      expect(await enforced(pending)).toEqual([])
    })
  })

  test("an activated run accepts no record-only resolution on any path", async () => {
    await within(async () => {
      const runId = await reviewed()
      const state = (await projectRunStateFromEvents(runId))!
      const before = (await readRunEvents(runId)).length
      const error = await rejection(
        appendEventOnly(
          runId,
          "capability_resolution_recorded",
          {
            subjectId: "op_record_only",
            enforcement: "record_only",
            path: "command_shell",
            initiator: "operator",
            capabilityId: "session.command.shell",
            enrolled: true,
            basis: "v2_grant",
            contractId: state.contractId,
            decision: "deny",
            reasonCode: "grant_absent",
          },
          "cmd_record_only",
          { correlationId: "op_record_only" },
        ),
      )
      expect(error).toBeInstanceOf(Error)
      expect((await readRunEvents(runId)).length).toBe(before)
    })
  })
})

describe("every other run keeps the isolated record-only path", () => {
  test("a v1 governed session never fails or is refused because its record could not be written", async () => {
    await within(async () => {
      const session = await Session.create({ title: "v1" })
      const { contract } = compileWithRunId({ request: { intent: { input: "Work on one file." } } }, session.id)
      await ContractGuardian.create(session.id, contract)
      await createEventAuthorityRun(session.id, contract.contractId)
      const original = Storage.write
      const write = spyOn(Storage, "write").mockImplementation((async (key: string[], value: unknown) => {
        if (
          key[0] === "run_events" &&
          Array.isArray(value) &&
          (value.at(-1) as { type?: string } | undefined)?.type === "capability_resolution_recorded"
        ) {
          throw new Error("injected resolution write failure")
        }
        return original(key, value)
      }) as typeof Storage.write)
      try {
        for (const action of actions(session.id).slice(0, 3)) {
          expect(await recordActionResolution(action)).toBeUndefined()
        }
      } finally {
        write.mockRestore()
      }
      // Written normally, it is record only and decides nothing.
      const recorded = await recordActionResolution(actions(session.id)[2]!)
      expect(recorded?.enforcement).toBe("record_only")
    })
  })
})

describe("action grants are accepted only from a compiled running image", () => {
  test("a compiled probe allows a granted session action inside its roots and denies outside them", async () => {
    const { contract } = compileWithRunId({ request: { intent: { input: "Inspect source." } } }, "ses_stage4c_probe")
    contract.toolAllowlist = []
    contract.toolBlocklist = []
    const contractFile = path.join(home, "contract.json")
    await fs.writeFile(contractFile, JSON.stringify(contract))
    await fs.mkdir(path.join(home, "repo", "src"), { recursive: true })
    await fs.writeFile(path.join(home, "repo", "src", "a.ts"), "")
    await fs.writeFile(path.join(home, "repo", "outside.ts"), "")
    const module = (name: string) => JSON.stringify(path.resolve(import.meta.dir, `../capability/${name}.ts`))
    const sessionModule = (name: string) => JSON.stringify(path.resolve(import.meta.dir, `../session/${name}.ts`))
    const entry = path.join(home, "action-probe.ts")
    await fs.writeFile(
      entry,
      `
import { readFileSync } from "node:fs"
import { proposeGrants } from ${module("grant-proposal")}
import { decideReviewedAction } from ${module("enforcement")}
import { daxExecutable } from ${module("implementation-binding")}
import { listOperatorShellCapabilities } from ${sessionModule("operator-shell-identity")}
import { listTemplateContextCapabilities } from ${sessionModule("template-context-identity")}
const [contractFile, repo] = process.argv.slice(2)
const contract = JSON.parse(readFileSync(contractFile, "utf8"))
const session = [...listOperatorShellCapabilities(), ...listTemplateContextCapabilities()]
const snapshot = { daxExecutable: daxExecutable(), tools: [], mcpServers: {}, session, workflow: [] }
const proposal = await proposeGrants({ runId: contract.runId, contract, snapshot,
  inputs: { toolAllowlist: [], toolBlocklist: [], workflowClass: contract.workflowClass, writeScope: { roots: ["src"], reviewed: true } } })
const activation = { revision: 1, contractDigest: "sha256:${"c".repeat(64)}", bindings: proposal.bindings.map(({ subject, attestation, digest }) => ({ subject, attestation, digest })) }
const decide = (path, descriptor, target) => decideReviewedAction({
  contract: proposal.candidate, contractDigest: activation.contractDigest, activation,
  resolve: { path, initiator: "operator", authorityRunId: contract.runId, executor: { kind: "builtin", descriptor }, ...(target ? { target } : {}), directory: repo, worktree: repo },
  current: snapshot,
})
const shell = session.find((item) => item.id === "session.shell.operator")
const stat = session.find((item) => item.id === "session.context.template.stat")
console.log(JSON.stringify({
  shell: await decide("operator_shell", shell),
  inside: await decide("template_reference", stat, { paths: [repo + "/src/a.ts"] }),
  outside: await decide("template_reference", stat, { paths: [repo + "/outside.ts"] }),
}))
`,
    )
    const outfile = path.join(home, "action-probe")
    const build = Bun.spawn(
      [process.execPath, "build", "--compile", "--define", `DAX_BUILD_COMMIT="probe"`, entry, "--outfile", outfile],
      { stdout: "pipe", stderr: "pipe" },
    )
    const [built, , buildErr] = await Promise.all([
      build.exited,
      new Response(build.stdout).text(),
      new Response(build.stderr).text(),
    ])
    if (built !== 0) throw new Error(buildErr)
    const run = Bun.spawn(
      [process.platform === "win32" ? `${outfile}.exe` : outfile, contractFile, path.join(home, "repo")],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [code, out, err] = await Promise.all([
      run.exited,
      new Response(run.stdout).text(),
      new Response(run.stderr).text(),
    ])
    if (code !== 0) throw new Error(err)
    const result = JSON.parse(out.trim().split("\n").at(-1)!)
    expect(result.shell).toMatchObject({
      enforcement: "enforced",
      decision: "allow",
      grantSubject: "session.shell.operator",
    })
    expect(result.inside).toMatchObject({ decision: "allow", grantScope: "filesystem" })
    expect(result.outside).toMatchObject({ decision: "deny", reasonCode: "scope_outside" })
  }, 120_000)
})
