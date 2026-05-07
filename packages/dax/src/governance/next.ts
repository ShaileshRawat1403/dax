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

  export const Request = z
    .object({
      id: Identifier.schema("permission"),
      createdAt: z.number().int().nonnegative(),
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
    })
    .meta({
      ref: "PermissionRequest",
    })

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

  async function classifyPatternsWithRust(patterns: string[]): Promise<Map<string, PathClassification>> {
    const paths = patterns.filter(Boolean)
    if (!rustPolicyEnabled() || paths.length === 0) return new Map()

    try {
      const classifications = await classifyPathsWithRust({ paths })
      return new Map(classifications.map((classification) => [classification.path, classification]))
    } catch (error) {
      log.warn("rust policy classification unavailable; using TypeScript rules only", { error })
      return new Map()
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

  export const reply = fn(
    z.object({
      requestID: Identifier.schema("permission"),
      reply: Reply,
      message: z.string().optional(),
    }),
    async (input) => {
      const s = await state()
      const existing = s.pending[input.requestID]
      if (!existing) return
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
