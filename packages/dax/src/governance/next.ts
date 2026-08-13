import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Storage } from "@/storage/storage"
import { fn } from "@/util/fn"
import { Log } from "@/util/log"
import { Wildcard } from "@/util/wildcard"
import { RAOLedger } from "@/rao"
import { classifyPathsWithRust, type PathClassification } from "@/rust/policy"
import { PolicyEngine } from "./policy-engine"
import { PermissionRequest } from "./permission-schema"
import z from "zod"

export namespace Permission {
  const log = Log.create({ service: "permission" })

  export const Action = PolicyEngine.Action
  export type Action = PolicyEngine.Action

  export const Rule = PolicyEngine.Rule
  export type Rule = PolicyEngine.Rule

  export const Ruleset = PolicyEngine.Ruleset
  export type Ruleset = PolicyEngine.Ruleset

  export const fromConfig = PolicyEngine.fromConfig
  export const merge = PolicyEngine.merge

  export const Request = PermissionRequest

  export type Request = z.infer<typeof Request>

  export const AskInput = z
    .object({
      id: Identifier.schema("permission").optional(),
      createdAt: z.number().int().nonnegative().optional(),
      sessionID: Identifier.schema("session"),
      permission: z.string(),
      patterns: z.string().array(),
      metadata: z.record(z.string(), z.any()),
      always: z.string().array(),
      tool: z
        .object({
          messageID: z.string(),
          callID: z.string(),
        })
        .optional(),
      ruleset: Ruleset,
    })
    .meta({
      ref: "PermissionAskInput",
    })

  export type AskInput = z.infer<typeof AskInput>

  export const Reply = z.enum(["once", "always", "reject"])
  export type Reply = z.infer<typeof Reply>

  export const Approval = z.object({
    projectID: z.string(),
    patterns: z.string().array(),
  })

  export const Event = {
    Asked: BusEvent.define("permission.asked", Request),
    Replied: BusEvent.define(
      "permission.replied",
      z.object({
        sessionID: z.string(),
        requestID: z.string(),
        reply: Reply,
      }),
    ),
  }

  const state = Instance.state(async () => {
    const projectID = Instance.project.id
    const stored = await Storage.read<Ruleset>(["permission", projectID]).catch(() => [] as Ruleset)

    const pending: Record<
      string,
      {
        info: Request
        resolve: () => void
        reject: (e: any) => void
      }
    > = {}

    return {
      pending,
      approved: stored,
    }
  })

  function rustPolicyEnabled() {
    return process.env.DAX_RUST_POLICY === "1" || process.env.DAX_RUST_POLICY === "true"
  }

  export type PolicyEffectsShape = {
    classifyPaths: typeof classifyPathsWithRust
  }

  /**
   * Test seam, matching WorkerRunEffects. The sidecar's absence is the case
   * worth asserting and it cannot be provoked on a machine that has the Rust
   * toolchain installed, so the classifier is injectable rather than the test
   * depending on what happens to be on PATH.
   */
  export const PolicyEffects = {
    current: { classifyPaths: classifyPathsWithRust } as PolicyEffectsShape,
    set(effects: Partial<PolicyEffectsShape>) {
      PolicyEffects.current = { classifyPaths: classifyPathsWithRust, ...effects }
    },
    reset() {
      PolicyEffects.current = { classifyPaths: classifyPathsWithRust }
    },
  }

  /**
   * Classify paths through the Rust policy engine when the operator has asked
   * for it.
   *
   * Fails closed. This previously logged a warning and returned an empty map,
   * which reads as "no path is forbidden and none is sensitive": forbidden
   * paths stopped being denied and sensitive paths stopped being escalated from
   * allow to ask. Someone who sets DAX_RUST_POLICY has chosen the stricter
   * classification, so silently applying the weaker ruleset removes a gate they
   * asked for and leaves only a log line behind. A permission decision is the
   * last place that should degrade quietly.
   */
  async function classifyPatternsWithRust(patterns: string[]): Promise<Map<string, PathClassification>> {
    const paths = patterns.filter(Boolean)
    if (!rustPolicyEnabled() || paths.length === 0) return new Map()

    try {
      const classifications = await PolicyEffects.current.classifyPaths({ paths })
      return new Map(classifications.map((classification) => [classification.path, classification]))
    } catch (error) {
      log.error("rust policy classification unavailable; refusing to fall back", { error })
      throw new PolicyUnavailableError(error)
    }
  }

  function minimumActionFor(classification: PathClassification | undefined): Action | undefined {
    if (classification?.zone === "forbidden") return "deny"
    if (classification?.zone === "sensitive") return "ask"
    return undefined
  }

  function clampAction(action: Action, minimum: Action | undefined): Action {
    if (minimum === "deny") return "deny"
    if (minimum === "ask" && action === "allow") return "ask"
    return action
  }

  function classificationDescription(classification: PathClassification | undefined): string | undefined {
    if (!classification) return undefined
    if (classification.zone === "forbidden") {
      return `DAX policy denied this forbidden path${classification.reason ? `: ${classification.reason}` : "."}`
    }
    if (classification.zone === "sensitive") {
      return `DAX policy requires approval for this sensitive path${classification.reason ? `: ${classification.reason}` : "."}`
    }
    return undefined
  }

  export const ask = fn(AskInput, async (input) => {
      const s = await state()
      const { ruleset, ...request } = input
      const classifications = await classifyPatternsWithRust(request.patterns ?? [])
      const forbidden = Array.from(classifications.values()).find((classification) => classification.zone === "forbidden")
      if (forbidden) {
        throw new DeniedError(
          ruleset.filter((r) => Wildcard.match(request.permission, r.permission)),
          classificationDescription(forbidden),
        )
      }
      for (const pattern of request.patterns ?? []) {
        const rule = evaluate(request.permission, pattern, ruleset, s.approved)
        const classification = classifications.get(pattern)
        const action = clampAction(rule.action, minimumActionFor(classification))
        log.info("evaluated", { permission: request.permission, pattern, action, rule, rustPolicy: classification })
        void RAOLedger.record({
          project_id: Instance.project.id,
          event_type: "audit",
          session_id: request.sessionID,
          message_id: request.tool?.messageID,
          payload: {
            permission: request.permission,
            pattern,
            action,
            rule_action: rule.action,
            rust_policy: classification ?? null,
            call_id: request.tool?.callID ?? null,
          },
        }).catch(() => undefined)
        if (action === "deny")
          throw new DeniedError(
            ruleset.filter((r) => Wildcard.match(request.permission, r.permission)),
            classificationDescription(classification),
          )
        if (action === "ask") {
          const id = input.id ?? Identifier.ascending("permission")
          return new Promise<void>((resolve, reject) => {
            const description = classificationDescription(classification)
            const info: Request = {
              id,
              createdAt: input.createdAt ?? Date.now(),
              ...request,
              metadata: description
                ? {
                    ...request.metadata,
                    description: request.metadata.description ?? description,
                    rustPolicy: classification,
                  }
                : request.metadata,
            }
            s.pending[id] = {
              info,
              resolve,
              reject,
            }
            Bus.publish(Event.Asked, info)
          })
        }
        if (action === "allow") continue
      }
    },
  )

  // Resolves a canonical approval record (one created via
  // ApprovalTransitions.create / createAndPersistApproval rather than
  // Permission.ask). This is the bridge for surfaces that route every
  // approval through `permission.reply`: when the requestID corresponds
  // to a canonical approval record, we look it up in ApprovalStore and
  // resolve through ApprovalTransitions so the approve/deny event chain
  // fires correctly.
  //
  // No-op if the requestID does not match a pending canonical approval
  // (e.g., already-resolved, expired, or never existed).
  async function resolveCanonicalApproval(
    requestID: string,
    reply: z.infer<typeof Reply>,
    message: string | undefined,
  ) {
    const { ApprovalStore } = await import("@/approval/approval-store")
    const { ApprovalTransitions, ApprovalAlreadyResolvedError } = await import(
      "@/approval/approval-transitions"
    )

    // The UI passes the approvalId as requestID but doesn't include the
    // runId. ApprovalStore is keyed by (runId, approvalId), so we scan the
    // approvals storage prefix to find the run that owns this id.
    // Approvals live at ["approvals", projectId, runId], one file per run.
    const projectId = Instance.project.id
    const paths = await Storage.list(["approvals", projectId])
    let approval: Awaited<ReturnType<typeof ApprovalStore.get>> | null = null
    const seenRuns = new Set<string>()
    for (const segments of paths) {
      const runId = segments[2]
      if (!runId || seenRuns.has(runId)) continue
      seenRuns.add(runId)
      const candidate = await ApprovalStore.get(runId, requestID).catch(() => null)
      if (candidate) {
        approval = candidate
        break
      }
    }
    if (!approval) return

    const comment = message ?? `Resolved via permission.reply (${reply})`
    try {
      if (reply === "reject") {
        await ApprovalTransitions.deny(approval.runId, approval.approvalId, "operator", comment)
      } else {
        await ApprovalTransitions.approve(approval.runId, approval.approvalId, "operator", comment)
      }
    } catch (err) {
      if (!(err instanceof ApprovalAlreadyResolvedError)) {
        throw err
      }
      // Already resolved race: harmless. The listener has already seen
      // the decision.
    }
  }

  export const reply = fn(
    z.object({
      // Accepts both legacy Permission.ask IDs (per_*) and canonical approval
      // record IDs (apr_*). The function body routes appropriately: in-memory
      // pending for per_*, ApprovalStore fallback for apr_*. The previous
      // strict per_-only schema rejected canonical IDs at validation time,
      // which made the deny button silently no-op for runtime-guard cards.
      requestID: z.string().min(1),
      reply: Reply,
      message: z.string().optional(),
    }),
    async (input) => {
      const s = await state()
      const existing = s.pending[input.requestID]
      if (!existing) {
        // Fallback: the request ID may correspond to a canonical approval
        // record (e.g., a runtime-guard workflow_gate) rather than an
        // in-memory Permission.ask request. Resolve via ApprovalTransitions
        // so the corresponding Lifecycle.ApprovalResolved event fires.
        // Listeners that paused on the approval (runtime guard, replay
        // verifiers) will see the decision and either resume or throw.
        await resolveCanonicalApproval(input.requestID, input.reply, input.message)
        return
      }
      delete s.pending[input.requestID]
      Bus.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        reply: input.reply,
      })
      void RAOLedger.record({
        project_id: Instance.project.id,
        event_type: "override",
        session_id: existing.info.sessionID,
        message_id: existing.info.tool?.messageID,
        payload: {
          request_id: existing.info.id,
          permission: existing.info.permission,
          reply: input.reply,
          call_id: existing.info.tool?.callID ?? null,
        },
      }).catch(() => undefined)
      if (input.reply === "reject") {
        existing.reject(input.message ? new CorrectedError(input.message) : new RejectedError())
        // Reject all other pending permissions for this session
        const sessionID = existing.info.sessionID
        for (const [id, pending] of Object.entries(s.pending)) {
          if (pending.info.sessionID === sessionID) {
            delete s.pending[id]
            Bus.publish(Event.Replied, {
              sessionID: pending.info.sessionID,
              requestID: pending.info.id,
              reply: "reject",
            })
            pending.reject(new RejectedError())
          }
        }
        return
      }
      if (input.reply === "once") {
        existing.resolve()
        return
      }
      if (input.reply === "always") {
        for (const pattern of existing.info.always) {
          s.approved.push({
            permission: existing.info.permission,
            pattern,
            action: "allow",
          })
        }

        try {
          await Storage.write(["permission", Instance.project.id], s.approved)
        } catch (e) {
          log.error("failed to persist approvals", { error: e })
        }

        existing.resolve()

        const sessionID = existing.info.sessionID
        for (const [id, pending] of Object.entries(s.pending)) {
          if (pending.info.sessionID !== sessionID) continue
          const ok = pending.info.patterns.every(
            (pattern) => evaluate(pending.info.permission, pattern, s.approved).action === "allow",
          )
          if (!ok) continue
          delete s.pending[id]
          Bus.publish(Event.Replied, {
            sessionID: pending.info.sessionID,
            requestID: pending.info.id,
            reply: "always",
          })
          pending.resolve()
        }

        return
      }
    },
  )

  export const evaluate = PolicyEngine.evaluate
  export const disabled = PolicyEngine.disabled

  /** User rejected without message - halts execution */
  export class RejectedError extends Error {
    constructor() {
      super(`The user rejected permission to use this specific tool call.`)
    }
  }

  /** User rejected with message - continues with guidance */
  export class CorrectedError extends Error {
    constructor(message: string) {
      super(`The user rejected permission to use this specific tool call with the following feedback: ${message}`)
    }
  }

  /** Auto-rejected by config rule - halts execution */
  /**
   * Raised when Rust path classification was requested but could not run.
   *
   * Distinct from DeniedError: nothing was denied, DAX simply cannot tell
   * whether it should be. The message is the operator's remedy, because the
   * two ways out are opposites and DAX must not pick one for them.
   */
  export class PolicyUnavailableError extends Error {
    constructor(public readonly reason: unknown) {
      super(
        "DAX_RUST_POLICY is enabled but the Rust policy engine could not run, so forbidden and sensitive " +
          "paths cannot be classified. DAX will not fall back to the weaker ruleset for a permission decision. " +
          "Either make the sidecar available (install the Rust toolchain, or point DAX_RUST_BIN_DIR at prebuilt " +
          "binaries), or unset DAX_RUST_POLICY to run with TypeScript rules deliberately. " +
          `Underlying error: ${reason instanceof Error ? reason.message : String(reason)}`,
      )
      this.name = "PolicyUnavailableError"
    }
  }

  export class DeniedError extends Error {
    constructor(public readonly ruleset: Ruleset, reason?: string) {
      super(
        reason ??
          `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${JSON.stringify(ruleset)}`,
      )
    }
  }

  export async function list() {
    return state().then((x) => Object.values(x.pending).map((x) => x.info))
  }

  export async function getApproved() {
    return state().then((x) => x.approved)
  }
}
