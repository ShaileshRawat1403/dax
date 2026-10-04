import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { resolveCapabilityAuthority } from "@/capability/authority"
import { decideReviewedAction } from "@/capability/enforcement"
import { proposeGrants } from "@/capability/grant-proposal"
import { GrantReview } from "@/capability/grant-review"
import { CapabilityActionDeniedError, recordActionResolution } from "@/capability/record-resolution"
import { Config } from "@/config/config"
import { compileWithRunId } from "@/execution/compiler"
import { ExecutionContractV2 } from "@/execution/execution-contract"
import { createGrantReviewedRun } from "@/execution/run-factory"
import { MCP } from "@/mcp"
import { mcpReadDescriptor, mcpReadDescriptorV2, mcpServerCommitment, parseMcpReadV2 } from "@/mcp/resource-identity"
import { Instance } from "@/project/instance"
import { appendEventOnly, resolveApprovalEvent } from "@/state/events/event-transitions"
import { projectRunStateFromEvents, readRunEvents } from "@/state/events/run-event-store"

/**
 * Grant stage 4c: server-provable MCP read identities (v2).
 *
 * A v2 resource or prompt identity commits to its server, so replay checks a
 * source grant's server by recomputing that commitment; the item digest is
 * checked for form only, because the item name is never recorded. v1 is
 * unchanged, is never v2 evidence, and is never covered by a source grant.
 */

const digestParts = (domain: string, parts: string[]) => {
  const hash = createHash("sha256").update(`${domain}\0`)
  for (const part of parts) {
    const bytes = Buffer.from(part, "utf8")
    hash.update(`${bytes.length}:`).update(bytes)
  }
  return hash.digest("hex")
}

describe("v2 read identities are minted by an exact, domain-separated rule", () => {
  test("v1 is unchanged; v2 commits to the server, separately per family", () => {
    // v1, recomputed independently of the module: historical identities are untouched.
    expect(mcpReadDescriptor("resource", "gamma", "file:///notes").id).toBe(
      `mcp.resource.v1.m${digestParts("dax.mcp.resource.v1", ["gamma", "file:///notes"])}`,
    )
    const v2 = mcpReadDescriptorV2("resource", "gamma", "file:///notes")
    expect(v2.id).toBe(
      `mcp.resource.v2.s${digestParts("dax.mcp.resource.server.v2", ["gamma"])}.m${digestParts("dax.mcp.resource.v2", ["gamma", "file:///notes"])}`,
    )
    expect(parseMcpReadV2(v2.id)).toEqual({
      family: "resource",
      serverDigest: mcpServerCommitment("resource", "gamma"),
      itemDigest: digestParts("dax.mcp.resource.v2", ["gamma", "file:///notes"]),
    })
    // Families and versions never share a digest for the same names.
    expect(mcpServerCommitment("resource", "gamma")).not.toBe(mcpServerCommitment("prompt", "gamma"))
    expect(mcpReadDescriptorV2("prompt", "gamma", "file:///notes").id).not.toContain(
      digestParts("dax.mcp.resource.v2", ["gamma", "file:///notes"]),
    )
    // Length prefixes keep part boundaries unambiguous.
    expect(mcpReadDescriptorV2("resource", "ab", "c").id).not.toBe(mcpReadDescriptorV2("resource", "a", "bc").id)
    // Malformed parts are refused, as in v1.
    expect(() => mcpReadDescriptorV2("resource", "", "x")).toThrow()
    expect(() => mcpReadDescriptorV2("resource", "gamma", "\uD800")).toThrow()
    // v1 and anything malformed are not v2.
    for (const id of [
      mcpReadDescriptor("resource", "gamma", "x").id,
      `mcp.resource.v2.s${"a".repeat(63)}.m${"b".repeat(64)}`,
      `mcp.resource.v2.s${"A".repeat(64)}.m${"b".repeat(64)}`,
      `mcp.resource.v2.s${"a".repeat(64)}.m${"b".repeat(64)}.x`,
      `mcp.resource.v2.m${"b".repeat(64)}`,
    ]) {
      expect(parseMcpReadV2(id)).toBeUndefined()
    }
  })

  test("an exact grant never covers a v2 identity, and a v1 identity is never covered by a source grant", () => {
    const { contract } = compileWithRunId({ request: { intent: { input: "Inspect source." } } }, "ses_mcp_v2")
    const v1 = mcpReadDescriptor("resource", "gamma", "file:///notes")
    const v2 = mcpReadDescriptorV2("resource", "gamma", "file:///notes")
    const withGrants = (grants: unknown[]) =>
      ExecutionContractV2.parse({
        ...contract,
        toolAllowlist: [],
        toolBlocklist: [],
        schemaVersion: "v2",
        capabilityGrants: grants,
      })
    const decide = (grantContract: ExecutionContractV2, descriptor: typeof v1) =>
      resolveCapabilityAuthority({
        path: "mcp_resource",
        initiator: "operator",
        contract: grantContract,
        authorityRunId: "ses_mcp_v2",
        executor: { kind: "mcp", descriptor },
        source: { server: "gamma", name: "file:///notes" },
        directory: os.tmpdir(),
        worktree: os.tmpdir(),
      })
    const exactV1 = withGrants([
      { subject: { kind: "capability", capabilityId: v1.id }, decision: "allow", scope: { kind: "run" } },
    ])
    expect(decide(exactV1, v2)).toMatchObject({ decision: "deny", reasonCode: "grant_absent" })
    const source = withGrants([
      {
        subject: { kind: "mcp_source", server: "gamma", family: "resource" },
        decision: "allow",
        scope: { kind: "run" },
      },
    ])
    expect(decide(source, v2)).toMatchObject({ decision: "allow" })
    // A v2 identity claimed for another server's source is not proven.
    expect(decide(source, mcpReadDescriptorV2("resource", "delta", "file:///notes"))).toMatchObject({
      decision: "deny",
      reasonCode: "source_unproven",
    })
  })
})

let home: string
let directory: string
let previousHome: string | undefined

beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "dax-grant-stage4c-v2-")))
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

async function activated() {
  const { runId, revision } = await createGrantReviewedRun(
    { request: { intent: { input: "Inspect the repository, read only." } }, availableTools: ["read"] },
    {
      acknowledgedExternal: ["mcp_source:resource:gamma", "mcp_source:prompt:gamma"],
      sourceSelections: [
        { server: "gamma", family: "resource" },
        { server: "gamma", family: "prompt" },
      ],
    },
  )
  await resolveApprovalEvent(runId, revision.approvalId, "approved", "operator")
  const subject = (await readRunEvents(runId))
    .filter((event) => event.type === "approval_requested")
    .map((event) => event.payload as { approvalId: string; contractGrantSubject?: unknown })
    .find((payload) => payload.approvalId === revision.approvalId)!.contractGrantSubject
  await GrantReview.publish(runId, { approvalId: revision.approvalId, subject })
  await GrantReview.activate(runId)
  return runId
}

describe("enforcement covers a read only under its v2 identity", () => {
  test("a proven v1 read is still refused under a source grant; its v2 identity is allowed", async () => {
    const { contract } = compileWithRunId({ request: { intent: { input: "Inspect source." } } }, "ses_mcp_v2_enforce")
    const snapshot = {
      daxExecutable: { form: "development" as const },
      tools: [],
      mcpServers: { gamma: { type: "remote" as const, url: "https://gamma.invalid/mcp", headers: [] } },
      session: [],
      workflow: [],
    }
    const proposal = await proposeGrants({
      runId: contract.runId,
      contract,
      snapshot,
      inputs: {
        toolAllowlist: [],
        toolBlocklist: [],
        workflowClass: contract.workflowClass,
        acknowledgedExternal: ["mcp_source:resource:gamma"],
        sourceSelections: [{ server: "gamma", family: "resource" }],
      },
    })
    const activation = {
      revision: 1,
      contractDigest: `sha256:${"c".repeat(64)}`,
      bindings: proposal.bindings.map(({ subject, attestation, digest }) => ({ subject, attestation, digest })),
    }
    const decide = (descriptor: ReturnType<typeof mcpReadDescriptor>) =>
      decideReviewedAction({
        contract: proposal.candidate,
        contractDigest: activation.contractDigest,
        activation,
        resolve: {
          path: "mcp_resource",
          initiator: "operator",
          authorityRunId: contract.runId,
          executor: { kind: "mcp", descriptor },
          source: { server: "gamma", name: "file:///notes" },
          directory: os.tmpdir(),
          worktree: os.tmpdir(),
        },
        current: snapshot,
      })
    expect(await decide(mcpReadDescriptor("resource", "gamma", "file:///notes"))).toMatchObject({
      decision: "deny",
      reasonCode: "source_unproven",
    })
    expect(await decide(mcpReadDescriptorV2("resource", "gamma", "file:///notes"))).toMatchObject({
      decision: "allow",
      grantSubject: "mcp_source:resource:gamma",
    })
  })
})

describe("replay checks a read's server, never its item name", () => {
  test("a gamma read is accepted; cross-server, historical v1 and malformed identities are refused", async () => {
    await within(async () => {
      const runId = await activated()
      const state = (await projectRunStateFromEvents(runId))!
      const activation = state.grantReview.activated!
      const record = (subjectId: string, capabilityId: string, family = "resource", extra: object = {}) => ({
        subjectId,
        enforcement: "enforced",
        activation: { revision: activation.revision, contractDigest: activation.contractDigest },
        path: family === "resource" ? "mcp_resource" : "mcp_prompt",
        initiator: "operator",
        capabilityId,
        enrolled: true,
        basis: "v2_grant",
        contractId: state.contractId,
        decision: "allow",
        grantScope: "run",
        grantSubject: `mcp_source:${family}:gamma`,
        ...extra,
      })
      const append = (payload: object) =>
        rejection(
          appendEventOnly(runId, "capability_resolution_recorded", payload as never, `cmd_${Math.random()}`, {
            correlationId: (payload as { subjectId: string }).subjectId,
          }),
        )
      const before = (await readRunEvents(runId)).length
      for (const payload of [
        record("op_delta", mcpReadDescriptorV2("resource", "delta", "file:///notes").id),
        record("op_v1", mcpReadDescriptor("resource", "gamma", "file:///notes").id),
        record("op_prompt_under_resource", mcpReadDescriptorV2("prompt", "gamma", "x").id),
        record("op_short", `mcp.resource.v2.s${mcpServerCommitment("resource", "gamma").slice(1)}.m${"b".repeat(64)}`),
        record("op_extra", `${mcpReadDescriptorV2("resource", "gamma", "x").id}.x`),
        record("op_with_source", mcpReadDescriptorV2("resource", "gamma", "x").id, "resource", {
          source: { server: "gamma", name: "x" },
        }),
      ]) {
        expect(await append(payload)).toBeInstanceOf(Error)
      }
      expect((await readRunEvents(runId)).length).toBe(before)
      expect(
        await append(record("op_gamma", mcpReadDescriptorV2("resource", "gamma", "file:///notes").id)),
      ).toBeUndefined()
      expect(
        await append(record("op_gamma_prompt", mcpReadDescriptorV2("prompt", "gamma", "review").id, "prompt")),
      ).toBeUndefined()
    })
  })

  test("a read the grant does not cover is denied before any read, and its item never reaches the journal", async () => {
    await within(async () => {
      const runId = await activated()
      const read = spyOn(MCP, "readResource")
      try {
        const error = await rejection(
          recordActionResolution({
            governedBy: { sessionID: runId },
            subject: "mcp_resource",
            path: "mcp_resource",
            initiator: "operator",
            executor: { kind: "mcp", descriptor: mcpReadDescriptor("resource", "delta", "file:///secret-plan") },
            source: { server: "delta", name: "file:///secret-plan" },
          }),
        )
        expect(error).toBeInstanceOf(CapabilityActionDeniedError)
        expect(read).not.toHaveBeenCalled()
      } finally {
        read.mockRestore()
      }
      const journal = JSON.stringify(await readRunEvents(runId))
      expect(journal).not.toContain("secret-plan")
      const denial = (await projectRunStateFromEvents(runId))!.capabilityResolutions.at(-1)!
      expect(denial).toMatchObject({ decision: "deny", path: "mcp_resource" })
      expect(denial.capabilityId).toBe(mcpReadDescriptorV2("resource", "delta", "file:///secret-plan").id)
    })
  })
})
