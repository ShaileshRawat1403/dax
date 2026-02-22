import { PM } from "@/pm"
import { fn } from "@/util/fn"
import z from "zod"

export namespace RAOLedger {
  export const EventType = z.enum(["run", "audit", "override"])
  export type EventType = z.infer<typeof EventType>

  export const record = fn(
    z.object({
      project_id: z.string(),
      event_type: EventType,
      payload: z.record(z.string(), z.unknown()),
      session_id: z.string().optional(),
      message_id: z.string().optional(),
      policy_hash: z.string().optional(),
      contract_hash: z.string().optional(),
    }),
    async (input) =>
      PM.append_event({
        project_id: input.project_id,
        event_type: input.event_type,
        payload: input.payload,
        session_id: input.session_id,
        message_id: input.message_id,
        policy_hash: input.policy_hash,
        contract_hash: input.contract_hash,
      }),
  )

  export const list = fn(
    z.object({
      project_id: z.string(),
      event_type: EventType.optional(),
      limit: z.number().int().positive().max(500).default(100),
    }),
    async (input) =>
      PM.list_events({
        project_id: input.project_id,
        event_type: input.event_type,
        limit: input.limit,
      }),
  )
}
