import { Database } from "bun:sqlite"
import { Global } from "@/global"
import { fn } from "@/util/fn"
import { Log } from "@/util/log"
import path from "path"
import { ulid } from "ulid"
import z from "zod"

export namespace PM {
  const log = Log.create({ service: "pm" })
  const db = (() => {
    const file = path.join(Global.Path.state, "pm.sqlite")
    const db = new Database(file, { create: true })
    db.exec(
      [
        "pragma journal_mode = wal;",
        "pragma synchronous = normal;",
        `create table if not exists pm_state (
          project_id text primary key,
          pm_rev integer not null default 1,
          risk_mode text not null default 'balanced',
          created_at integer not null,
          updated_at integer not null
        );`,
        `create table if not exists pm_constraints (
          id text primary key,
          project_id text not null,
          rule_type text not null,
          pattern text not null,
          action text not null,
          source text not null,
          created_at integer not null
        );`,
        "create index if not exists idx_pm_constraints_project on pm_constraints(project_id, created_at desc);",
        `create table if not exists pm_preferences (
          project_id text not null,
          pref_key text not null,
          pref_value text not null,
          updated_at integer not null,
          primary key (project_id, pref_key)
        );`,
        `create table if not exists pm_dsr (
          id text primary key,
          project_id text not null,
          day text not null,
          title text not null,
          note text not null,
          tags text not null,
          author text,
          session_id text,
          source text not null,
          created_at integer not null
        );`,
        "create index if not exists idx_pm_dsr_project_day on pm_dsr(project_id, day desc, created_at desc);",
        `create table if not exists pm_rao_event (
          id text primary key,
          project_id text not null,
          session_id text,
          message_id text,
          event_type text not null,
          payload text not null,
          policy_hash text,
          contract_hash text,
          pm_rev integer not null,
          created_at integer not null
        );`,
        "create index if not exists idx_pm_rao_project_time on pm_rao_event(project_id, created_at desc);",
      ].join("\n"),
    )
    return db
  })()

  const RiskMode = z.enum(["conservative", "balanced", "aggressive"])
  const EventType = z.enum(["run", "audit", "override"])
  const RuleType = z.enum(["never_touch", "require_approval", "deny_tool", "allow_tool"])
  const RuleAction = z.enum(["allow", "deny", "ask"])
  const RuleSource = z.enum(["default", "user", "override"])

  const TouchStateInput = z.object({
    project_id: z.string(),
    risk_mode: RiskMode.optional(),
  })

  function touch(project_id: string, risk_mode?: z.infer<typeof RiskMode>) {
    const now = Date.now()
    const current = db
      .prepare("select project_id, pm_rev, risk_mode, created_at, updated_at from pm_state where project_id = ?")
      .get(project_id) as
      | {
          project_id: string
          pm_rev: number
          risk_mode: z.infer<typeof RiskMode>
          created_at: number
          updated_at: number
        }
      | undefined
    if (!current) {
      db.prepare(
        `insert into pm_state (project_id, pm_rev, risk_mode, created_at, updated_at)
         values (?, ?, ?, ?, ?)`,
      ).run(project_id, 1, risk_mode ?? "balanced", now, now)
      return {
        project_id,
        pm_rev: 1,
        risk_mode: risk_mode ?? ("balanced" as const),
        created_at: now,
        updated_at: now,
      }
    }
    db.prepare("update pm_state set risk_mode = ?, updated_at = ? where project_id = ?").run(
      risk_mode ?? current.risk_mode,
      now,
      project_id,
    )
    return {
      ...current,
      risk_mode: risk_mode ?? current.risk_mode,
      updated_at: now,
    }
  }

  export const touch_state = fn(TouchStateInput, async (input) => touch(input.project_id, input.risk_mode))

  export const get_state = fn(
    z.object({
      project_id: z.string(),
    }),
    async (input) => {
      const state = db
        .prepare("select project_id, pm_rev, risk_mode, created_at, updated_at from pm_state where project_id = ?")
        .get(input.project_id) as
        | {
            project_id: string
            pm_rev: number
            risk_mode: z.infer<typeof RiskMode>
            created_at: number
            updated_at: number
          }
        | undefined
      return state ?? touch(input.project_id)
    },
  )

  export const set_preference = fn(
    z.object({
      project_id: z.string(),
      pref_key: z.string(),
      pref_value: z.string(),
    }),
    async (input) => {
      touch(input.project_id)
      const now = Date.now()
      db.prepare(
        `insert into pm_preferences (project_id, pref_key, pref_value, updated_at)
         values (?, ?, ?, ?)
         on conflict(project_id, pref_key)
         do update set pref_value = excluded.pref_value, updated_at = excluded.updated_at`,
      ).run(input.project_id, input.pref_key, input.pref_value, now)
      return { ...input, updated_at: now }
    },
  )

  export const list_preferences = fn(
    z.object({
      project_id: z.string(),
    }),
    async (input) => {
      touch(input.project_id)
      return db
        .prepare("select project_id, pref_key, pref_value, updated_at from pm_preferences where project_id = ?")
        .all(input.project_id) as Array<{
        project_id: string
        pref_key: string
        pref_value: string
        updated_at: number
      }>
    },
  )

  export const add_constraint = fn(
    z.object({
      project_id: z.string(),
      rule_type: RuleType,
      pattern: z.string(),
      action: RuleAction,
      source: RuleSource.default("user"),
    }),
    async (input) => {
      touch(input.project_id)
      const row = {
        id: ulid(),
        created_at: Date.now(),
        ...input,
      }
      db.prepare(
        `insert into pm_constraints (id, project_id, rule_type, pattern, action, source, created_at)
         values (?, ?, ?, ?, ?, ?, ?)`,
      ).run(row.id, row.project_id, row.rule_type, row.pattern, row.action, row.source, row.created_at)
      return row
    },
  )

  export const list_constraints = fn(
    z.object({
      project_id: z.string(),
      limit: z.number().int().positive().max(500).default(100),
    }),
    async (input) => {
      touch(input.project_id)
      return db
        .prepare(
          `select id, project_id, rule_type, pattern, action, source, created_at
           from pm_constraints
           where project_id = ?
           order by created_at desc
           limit ?`,
        )
        .all(input.project_id, input.limit) as Array<{
        id: string
        project_id: string
        rule_type: z.infer<typeof RuleType>
        pattern: string
        action: z.infer<typeof RuleAction>
        source: z.infer<typeof RuleSource>
        created_at: number
      }>
    },
  )

  const SaveDSRInput = z.object({
    project_id: z.string(),
    day: z.string().optional(),
    title: z.string(),
    note: z.string(),
    tags: z.array(z.string()).optional(),
    author: z.string().optional(),
    session_id: z.string().optional(),
    source: z.enum(["agent", "user", "system"]).default("agent"),
  })

  export const save_dsr = fn(SaveDSRInput, async (input) => {
    touch(input.project_id)
    const now = Date.now()
    const day = input.day ?? new Date(now).toISOString().slice(0, 10)
    const id = ulid()
    db.prepare(
      `insert into pm_dsr
        (id, project_id, day, title, note, tags, author, session_id, source, created_at)
       values
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.project_id,
      day,
      input.title.trim(),
      input.note.trim(),
      JSON.stringify(input.tags ?? []),
      input.author ?? null,
      input.session_id ?? null,
      input.source,
      now,
    )
    log.info("saved dsr", { id, project_id: input.project_id, day })
    return { id, day, created_at: now }
  })

  export const list_dsr = fn(
    z.object({
      project_id: z.string(),
      day: z.string().optional(),
      limit: z.number().int().positive().max(200).default(20),
    }),
    async (input) => {
      touch(input.project_id)
      const stmt = input.day
        ? db.prepare(
            `select id, project_id, day, title, note, tags, author, session_id, source, created_at
             from pm_dsr
             where project_id = ? and day = ?
             order by created_at desc
             limit ?`,
          )
        : db.prepare(
            `select id, project_id, day, title, note, tags, author, session_id, source, created_at
             from pm_dsr
             where project_id = ?
             order by created_at desc
             limit ?`,
          )
      const rows = (input.day
        ? stmt.all(input.project_id, input.day, input.limit)
        : stmt.all(input.project_id, input.limit)) as Array<{
        id: string
        project_id: string
        day: string
        title: string
        note: string
        tags: string
        author: string | null
        session_id: string | null
        source: "agent" | "user" | "system"
        created_at: number
      }>
      return rows.map((x) => ({ ...x, tags: JSON.parse(x.tags) as string[] }))
    },
  )

  export const append_event = fn(
    z.object({
      project_id: z.string(),
      event_type: EventType,
      payload: z.record(z.string(), z.unknown()),
      session_id: z.string().optional(),
      message_id: z.string().optional(),
      policy_hash: z.string().optional(),
      contract_hash: z.string().optional(),
    }),
    async (input) => {
      const state = touch(input.project_id)
      const id = ulid()
      const created_at = Date.now()
      db.prepare(
        `insert into pm_rao_event
          (id, project_id, session_id, message_id, event_type, payload, policy_hash, contract_hash, pm_rev, created_at)
         values
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.project_id,
        input.session_id ?? null,
        input.message_id ?? null,
        input.event_type,
        JSON.stringify(input.payload),
        input.policy_hash ?? null,
        input.contract_hash ?? null,
        state.pm_rev,
        created_at,
      )
      return { id, pm_rev: state.pm_rev, created_at }
    },
  )

  export const list_events = fn(
    z.object({
      project_id: z.string(),
      event_type: EventType.optional(),
      limit: z.number().int().positive().max(500).default(100),
    }),
    async (input) => {
      touch(input.project_id)
      const rows = input.event_type
        ? (db
            .prepare(
              `select id, project_id, session_id, message_id, event_type, payload, policy_hash, contract_hash, pm_rev, created_at
               from pm_rao_event
               where project_id = ? and event_type = ?
               order by created_at desc
               limit ?`,
            )
            .all(input.project_id, input.event_type, input.limit) as Array<{
            id: string
            project_id: string
            session_id: string | null
            message_id: string | null
            event_type: z.infer<typeof EventType>
            payload: string
            policy_hash: string | null
            contract_hash: string | null
            pm_rev: number
            created_at: number
          }>)
        : (db
            .prepare(
              `select id, project_id, session_id, message_id, event_type, payload, policy_hash, contract_hash, pm_rev, created_at
               from pm_rao_event
               where project_id = ?
               order by created_at desc
               limit ?`,
            )
            .all(input.project_id, input.limit) as Array<{
            id: string
            project_id: string
            session_id: string | null
            message_id: string | null
            event_type: z.infer<typeof EventType>
            payload: string
            policy_hash: string | null
            contract_hash: string | null
            pm_rev: number
            created_at: number
          }>)
      return rows.map((x) => ({
        ...x,
        payload: JSON.parse(x.payload as string) as Record<string, unknown>,
      })) as Array<{
        id: string
        project_id: string
        session_id: string | null
        message_id: string | null
        event_type: z.infer<typeof EventType>
        payload: Record<string, unknown>
        policy_hash: string | null
        contract_hash: string | null
        pm_rev: number
        created_at: number
      }>
    },
  )
}
