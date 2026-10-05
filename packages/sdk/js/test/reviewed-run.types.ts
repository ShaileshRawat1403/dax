/** Typecheck-only controls: keep runtime build inputs unchanged. No casts or ignored errors. */
import type * as V1 from "../src/gen/types.gen.js"
import type * as V2 from "../src/v2/gen/types.gen.js"
import type { DaxClient as Client1 } from "../src/gen/sdk.gen.js"
import type { DaxClient as Client2 } from "../src/v2/gen/sdk.gen.js"

type Assert<T extends true> = T
type ReviewedCreate = {
  intent: { input: "Inspect source." }
  workflowHint: "generic"
  capabilityReview: { mode: "reviewed_grants" }
}
type ValidatorFailure = { data: {}; error: [{ message: "Invalid input" }]; success: false }
type Refusal = { code: "review_missing"; message: "Reviewed run refused: review_missing"; runId: "ses_missing" }
export type ReviewedRunTypeControls = [
  Assert<ReviewedCreate extends V1.CreateRunRequestV1 ? true : false>,
  Assert<ReviewedCreate extends V2.CreateRunRequestV1 ? true : false>,
  Assert<{ intent: "invalid" } extends V1.CreateRunRequestV1 ? false : true>,
  Assert<{ intent: "invalid" } extends V2.CreateRunRequestV1 ? false : true>,
  Assert<
    { createRunRequestV1: ReviewedCreate } extends NonNullable<Parameters<Client1["run"]["create"]>[0]> ? true : false
  >,
  Assert<
    { createRunRequestV1: ReviewedCreate } extends NonNullable<Parameters<Client2["run"]["create"]>[0]> ? true : false
  >,
  Assert<ValidatorFailure extends V1.RunCreateErrors[400] ? true : false>,
  Assert<ValidatorFailure extends V2.RunCreateErrors[400] ? true : false>,
  Assert<ValidatorFailure extends V1.RunGrantReviewReviseErrors[400] ? true : false>,
  Assert<ValidatorFailure extends V2.RunGrantReviewStartErrors[400] ? true : false>,
  Assert<ValidatorFailure extends V1.RunApprovalsResolveErrors[400] ? true : false>,
  Assert<ValidatorFailure extends V2.RunApprovalsResolveErrors[400] ? true : false>,
  Assert<Refusal extends V1.RunGrantReviewReviseErrors[404] ? true : false>,
  Assert<Refusal extends V2.RunGrantReviewReviseErrors[404] ? true : false>,
  Assert<Refusal extends V1.RunGrantReviewStartErrors[409] ? true : false>,
  Assert<Refusal extends V2.RunCreateErrors[404] ? true : false>,
  Assert<"worker_run" extends NonNullable<V1.CreateRunRequestV1["workflowHint"]> ? true : false>,
  Assert<"worker_run" extends NonNullable<V2.CreateRunRequestV1["workflowHint"]> ? true : false>,
]
