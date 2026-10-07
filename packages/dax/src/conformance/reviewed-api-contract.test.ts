import * as Secrets from "@/secrets/secrets-loader"
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Hono } from "hono"
import { generateSpecs } from "hono-openapi"
import { RunRoutes } from "@/server/routes/run"
import { Instance } from "@/project/instance"
import { Config } from "@/config/config"
import { ReviewedRunRefusal, RunBadRequestError } from "@/capability/reviewed-run-contract"
import { createGrantReviewedRun } from "@/execution/run-factory"
import { readRunEvents } from "@/state/events/run-event-store"
import { createDaxClient as v1 } from "../../../sdk/js/src/client"
import { createDaxClient as v2 } from "../../../sdk/js/src/v2/client"

const authorization = `Basic ${btoa("operator:owned-contract-test-password")}`
let secret: ReturnType<typeof spyOn<typeof Secrets, "getSecrets">>
let home: string
let oldHome: string | undefined
beforeEach(async () => {
  secret = spyOn(Secrets, "getSecrets").mockResolvedValue({
    serverUsername: "operator",
    serverPassword: "owned-contract-test-password",
  } as never)
  oldHome = process.env.DAX_TEST_HOME
  home = await fs.mkdtemp(path.join(os.tmpdir(), "dax-reviewed-api-contract-"))
  process.env.DAX_TEST_HOME = home
  await fs.mkdir(path.join(home, ".config", "dax"), { recursive: true })
  await Instance.disposeAll()
  Config.global.reset()
})
afterEach(async () => {
  secret.mockRestore()
  await Instance.disposeAll()
  Config.global.reset()
  if (oldHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = oldHome
  await fs.rm(home, { recursive: true, force: true })
})
const pins = {
  revision: 1,
  approvalId: "missing",
  proposalDigest: `sha256:${"a".repeat(64)}`,
  contractDigest: `sha256:${"b".repeat(64)}`,
  bindingManifestDigest: `sha256:${"c".repeat(64)}`,
}

test("real Hono reviewed validator/refusal/missing responses match additive OpenAPI", async () => {
  await Instance.provide({
    directory: home,
    fn: async () => {
      const app = new Hono().route("/runs", RunRoutes())
      const spec = await generateSpecs(app)
      const request = (url: string, body: unknown) =>
        app.request(url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization },
          body: JSON.stringify(body),
        })
      for (const suffix of ["start", "revisions"] as const) {
        const url = `/runs/ses_missing/grant-review/${suffix}`
        const operation = spec.paths?.[`/runs/{runID}/grant-review/${suffix}`]?.post
        const invalid = await request(url, {})
        expect(invalid.status).toBe(400)
        const validation = await invalid.json()
        expect(RunBadRequestError.safeParse(validation).success).toBe(true)
        expect(JSON.stringify(operation?.responses?.[400])).toContain("RunBadRequestError")
        const missing = await request(url, suffix === "start" ? { expected: pins } : { expected: pins, inputs: {} })
        expect(missing.status).toBe(suffix === "start" ? 409 : 404) // Source image fails start before absence lookup.
        expect(ReviewedRunRefusal.safeParse(await missing.json()).success).toBe(true)
        expect(operation?.responses?.[missing.status]).toBeDefined()
        const malformed = await app.request(url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization },
          body: "{",
        })
        expect(malformed.status).toBe(400)
        expect(await malformed.text()).toBe("Malformed JSON in request body")
        expect(JSON.stringify(operation?.responses?.[400])).toContain("text/plain")
      }
      const create = await request("/runs", {
        intent: { input: "Inspect" },
        workflowHint: "repo_analyze",
        capabilityReview: { mode: "reviewed_grants" },
      })
      expect(create.status).toBe(400)
      expect(ReviewedRunRefusal.safeParse(await create.json()).success).toBe(true)
      expect(JSON.stringify(spec.paths?.["/runs"]?.post?.responses?.[400])).toContain("ReviewedRunRefusal")
      expect(JSON.stringify(spec.paths?.["/runs"]?.post?.responses?.[400])).toContain("BadRequestError")
      const successor = await request("/runs", {
        intent: { input: "Inspect" },
        workflowHint: "generic",
        capabilityReview: { mode: "reviewed_grants", successorOf: "ses_missing" },
      })
      expect(successor.status).toBe(404)
      expect(ReviewedRunRefusal.safeParse(await successor.json()).success).toBe(true)
      expect(spec.paths?.["/runs"]?.post?.responses?.[404]).toBeDefined()
      const created = await createGrantReviewedRun({ request: { intent: { input: "Inspect source." } } })
      const before = await readRunEvents(created.runId)
      const approval = await request(`/runs/${created.runId}/approvals/${created.revision.approvalId}`, {
        decision: "approve",
        actorId: " ",
      })
      expect(approval.status).toBe(400)
      expect(ReviewedRunRefusal.safeParse(await approval.json()).success).toBe(true)
      expect(await readRunEvents(created.runId)).toEqual(before)
      const operation = spec.paths?.["/runs/{runID}/approvals/{approvalID}"]?.post
      expect(JSON.stringify(operation?.responses?.[400])).toContain("RunBadRequestError")
      expect(JSON.stringify(operation?.responses?.[400])).toContain("ReviewedRunRefusal")
      expect(operation?.responses?.[409]).toBeDefined()
      expect(spec.components?.schemas?.RunBadRequestError).toMatchObject({
        properties: { error: { type: "array" }, success: { const: false } },
      })
    },
  })
})

for (const [name, create] of [
  ["v1", v1],
  ["v2", v2],
] as const) {
  test(`${name} SDK transports actual Hono validator, missing and semantic refusal shapes`, async () => {
    await Instance.provide({
      directory: home,
      fn: async () => {
        const app = new Hono().route("/runs", RunRoutes())
        const client = create({
          baseUrl: "http://dax.local",
          headers: { authorization },
          fetch: Object.assign(
            async (request: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(request, init)),
            {
              preconnect: fetch.preconnect,
            },
          ),
        })
        const invalid = await client.run.grantReview.start({ runID: "ses_missing" })
        expect(RunBadRequestError.safeParse(invalid.error).success).toBe(true)
        const missing = await client.run.grantReview.revise({
          runID: "ses_missing",
          reviseGrantReviewRequest: { expected: pins, inputs: {} },
        })
        expect(missing.response.status).toBe(404)
        expect(missing.error).toMatchObject({ code: "review_missing", message: "Reviewed run refused: review_missing" })
        const semantic = await client.run.create({
          createRunRequestV1: {
            intent: { input: "Inspect source." },
            workflowHint: "repo_analyze",
            capabilityReview: { mode: "reviewed_grants" },
          },
        })
        expect(semantic.response.status).toBe(400)
        expect(ReviewedRunRefusal.safeParse(semantic.error).success).toBe(true)
      },
    })
  })
}
