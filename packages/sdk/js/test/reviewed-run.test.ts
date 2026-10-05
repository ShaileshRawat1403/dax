import { expect, test } from "bun:test"
import { createDaxClient as v1 } from "../src/client"
import { createDaxClient as v2 } from "../src/v2/client"

for (const [version, create] of [
  ["v1", v1],
  ["v2", v2],
] as const) {
  test(`${version} additive review methods preserve legacy transport and exact pins`, async () => {
    const requests: Request[] = []
    let refusal = false
    const client = create({
      baseUrl: "http://sdk.local",
      directory: "/project",
      fetch: async (request) => {
        requests.push(request as Request)
        return Response.json(
          refusal
            ? { code: "stale_pins", message: "Reviewed run refused: stale_pins", runId: "ses_test" }
            : { ok: true },
          {
            status: refusal ? 409 : 200,
          },
        )
      },
    })
    const pins = {
      revision: 2,
      approvalId: "apr_r2",
      proposalDigest: `sha256:${"1".repeat(64)}`,
      contractDigest: `sha256:${"2".repeat(64)}`,
      bindingManifestDigest: `sha256:${"3".repeat(64)}`,
    }
    await client.run.create({ createRunRequestV1: { intent: { input: "inspect" } } })
    expect(await requests[0]!.json()).toEqual({ intent: { input: "inspect" } })
    expect(requests[0]!.headers.get("x-dax-directory")).toBe("/project")
    await client.run.create({
      createRunRequestV1: {
        intent: { input: "inspect" },
        workflowHint: "generic",
        capabilityReview: { mode: "reviewed_grants" },
      },
    })
    expect((await requests[1]!.json()).capabilityReview).toEqual({ mode: "reviewed_grants" })
    await client.run.grantReview.get({ runID: "ses_test", directory: "/other" })
    expect(new URL(requests[2]!.url).pathname).toBe("/runs/ses_test/grant-review")
    expect(new URL(requests[2]!.url).searchParams.get("directory")).toBe("/other")
    await client.run.grantReview.revise({ runID: "ses_test", reviseGrantReviewRequest: { expected: pins, inputs: {} } })
    expect(new URL(requests[3]!.url).pathname).toBe("/runs/ses_test/grant-review/revisions")
    expect(await requests[3]!.json()).toEqual({ expected: pins, inputs: {} })
    refusal = true
    const result = await client.run.grantReview.start({
      runID: "ses_test",
      startGrantReviewRequest: { expected: pins },
    })
    expect(new URL(requests[4]!.url).pathname).toBe("/runs/ses_test/grant-review/start")
    expect(await requests[4]!.json()).toEqual({ expected: pins })
    expect(result.error).toEqual({ code: "stale_pins", message: "Reviewed run refused: stale_pins", runId: "ses_test" })
    refusal = false
    await client.run.approvals.resolve({
      runID: "ses_test",
      approvalID: "apr_ask",
      resolveApprovalRequestV1: {
        decision: "approve",
        actorId: "operator",
        remember: true,
      },
    })
    expect(new URL(requests[5]!.url).pathname).toBe("/runs/ses_test/approvals/apr_ask")
    expect(await requests[5]!.json()).toEqual({ decision: "approve", actorId: "operator", remember: true })
  })
}
