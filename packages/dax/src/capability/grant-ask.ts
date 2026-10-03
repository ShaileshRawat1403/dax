import { ApprovalTransitions } from "@/approval/approval-transitions"
import { Bus } from "@/bus"
import { Lifecycle } from "@/bus/lifecycle"
import { appendEventOnly } from "@/state/events/event-transitions"
import { CONTRACT_GRANT_ASK_TYPE, type GrantAskSubject } from "@/state/events/contract-grant-approval"
import { projectRunStateFromEvents } from "@/state/events/run-event-store"
import { Log } from "@/util/log"

const log = Log.create({ service: "grant-ask" })

/**
 * Stage 4c: the operator's answer to an `ask` grant in an activated reviewed
 * run. The request names exactly what is approved; an approval the operator
 * chose to remember covers that same tuple later, and nothing else.
 */

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000

function timeoutMs() {
  const raw = process.env.DAX_GRANT_ASK_TIMEOUT_MS
  const parsed = raw === undefined ? NaN : Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_TIMEOUT_MS
}

function same(a: GrantAskSubject, b: GrantAskSubject) {
  return (
    a.grantSubject === b.grantSubject &&
    a.capabilityId === b.capabilityId &&
    a.contractDigest === b.contractDigest &&
    a.bindingDigest === b.bindingDigest
  )
}

/** An approval remembered for exactly this tuple, if the operator chose "always" for one. */
export async function rememberedAsk(runId: string, subject: GrantAskSubject): Promise<string | undefined> {
  const remembered = (await projectRunStateFromEvents(runId))?.grantReview.remembered ?? {}
  return Object.entries(remembered).find(([, item]) => same(item, subject))?.[0]
}

/**
 * Asks the operator and waits for the answer. The request is correlated to the
 * action it gates and appended under the run lock; the answer is read from the
 * run log, so an answer given before the wait began still counts. No answer
 * in time expires the request and denies.
 */
export async function askOperator(
  runId: string,
  correlationId: string,
  subject: GrantAskSubject,
): Promise<{ approvalId: string; decision: "approved" | "denied" | "expired" }> {
  const approvalId = `apr_grant_ask_${correlationId}`
  // Approved only by a named operator, as the reducer requires; an anonymous
  // approval is no approval of a grant ask.
  const decided = async () => {
    const approval = (await projectRunStateFromEvents(runId))?.approvals.find((item) => item.approvalId === approvalId)
    if (approval?.status === "approved" && !approval.decidedBy?.trim()) return "unnamed"
    return approval?.status
  }
  const settle = (status: string | undefined) =>
    status === "approved"
      ? ("approved" as const)
      : status === "pending" || status === undefined
        ? undefined
        : ("denied" as const)

  const answer = new Promise<"approved" | "denied" | "expired">((resolve) => {
    let finished = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (value: "approved" | "denied" | "expired") => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      unsubscribe()
      resolve(value)
    }
    const unsubscribe = Bus.subscribe(Lifecycle.ApprovalResolved, async (event) => {
      if (event.properties.runId !== runId || event.properties.approvalId !== approvalId) return
      finish((settle(await decided()) ?? "denied") as "approved" | "denied")
    })
    // Requested after subscribing, so no answer can fall between the two.
    void appendEventOnly(
      runId,
      "approval_requested",
      {
        approvalId,
        approvalType: CONTRACT_GRANT_ASK_TYPE,
        risk: "high",
        title: `Allow ${subject.capabilityId} under ${subject.grantSubject}`,
        reason: "The reviewed contract grants this capability only with your approval each time.",
        source: "system",
        grantAskSubject: subject,
      },
      `cmd_grant_ask_${correlationId}`,
      { correlationId },
      { rejectDuplicateCommand: true },
    )
      .then(async () => {
        const already = settle(await decided())
        if (already) return finish(already)
        // The clock starts only once the request is in the log, so an expiry
        // always has a request to close.
        timer = setTimeout(() => finish("expired"), timeoutMs())
      })
      .catch(() => finish("denied"))
  })
  const decision = await answer
  if (decision === "expired") {
    // Closed in the log; if that fails the request is left pending, but the
    // action is denied either way and nothing can authorize it afterwards.
    await ApprovalTransitions.expire(runId, approvalId).catch((error) =>
      log.warn("grant ask could not be expired", { runId, approvalId, error }),
    )
  }
  return { approvalId, decision }
}

/**
 * The operator's answer to a grant ask. `always` remembers it for exactly the
 * asked tuple, recorded in the run log after the approval itself.
 */
export async function answerGrantAsk(
  runId: string,
  approvalId: string,
  answer: { approve: boolean; actor: string; always?: boolean },
): Promise<void> {
  if (!answer.approve) {
    await ApprovalTransitions.deny(runId, approvalId, answer.actor)
    return
  }
  const subject = (await projectRunStateFromEvents(runId))?.grantReview.asks[approvalId]
  if (!subject) throw new Error(`No grant ask ${approvalId} in run ${runId}`)
  await ApprovalTransitions.approve(runId, approvalId, answer.actor)
  // Remembered only after the approval it depends on is in the log. If this
  // append fails, the one approval stands and nothing is remembered.
  if (answer.always) {
    await appendEventOnly(
      runId,
      "grant_ask_remembered",
      { approvalId, subject },
      `cmd_grant_ask_remember_${approvalId}`,
    )
  }
}
