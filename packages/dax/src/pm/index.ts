import { Database } from "bun:sqlite"
import { Global } from "@/global"
import { fn } from "@/util/fn"
import { Log } from "@/util/log"
import path from "path"
import { monotonicFactory } from "ulid"
import z from "zod"
import fs from "fs"

export namespace PM {
  const log = Log.create({ service: "pm" })

  /**
   * Monotonic so that ids sort by insertion order even within a millisecond.
   *
   * Every list here orders by created_at, which has millisecond resolution, so
   * rows written in the same tick came back in whatever order SQLite chose.
   * For an audit trail that is a real problem: the RAO event list is the
   * record of what happened in what order. A plain ulid() shares the timestamp
   * prefix but randomises the suffix, so it cannot break the tie either.
   */
  const ulid = monotonicFactory()
  const db = (() => {
    const file = path.join(Global.Path.state, "pm.sqlite")
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const db = new Database(file, { create: true })
    // DAX commonly has a TUI and operator commands open together. Apply the
    // wait policy before WAL/schema setup so concurrent process startup does
    // not surface SQLITE_BUSY_RECOVERY to the operator.
    db.exec("pragma busy_timeout = 5000;")
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
        "create index if not exists idx_pm_rao_session on pm_rao_event(project_id, session_id, created_at desc);",
        `create table if not exists pm_memory (
          id text primary key,
          project_id text not null,
          session_id text,
          category text not null,
          title text not null,
          content text not null,
          tags text not null,
          source text not null,
          created_at integer not null
        );`,
        "create index if not exists idx_pm_memory_project_time on pm_memory(project_id, created_at desc);",
        "create index if not exists idx_pm_memory_category on pm_memory(project_id, category, created_at desc);",
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

  function readState(project_id: string) {
    return db
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
  }

  function defaultState(project_id: string, now = Date.now(), risk_mode?: z.infer<typeof RiskMode>) {
    return {
      project_id,
      pm_rev: 1,
      risk_mode: risk_mode ?? ("balanced" as const),
      created_at: now,
      updated_at: now,
    }
  }

  /**
   * Mark a project's memory as seen, and optionally as changed.
   *
   * `pm_rev` is stamped onto every RAO event so a reader can tell which
   * revision of project memory was in force when it was recorded. It was never
   * incremented: every event in every database carried pm_rev 1 regardless of
   * how many constraints or preferences had changed since, which made it a
   * provenance field that recorded nothing. It now advances whenever memory
   * that can influence a decision is written, and stays put on reads.
   */
  function touch(project_id: string, risk_mode?: z.infer<typeof RiskMode>, mutated = false) {
    const now = Date.now()
    const current = readState(project_id)
    if (!current) {
      db.prepare(
        `insert into pm_state (project_id, pm_rev, risk_mode, created_at, updated_at)
         values (?, ?, ?, ?, ?)`,
      ).run(project_id, 1, risk_mode ?? "balanced", now, now)
      return defaultState(project_id, now, risk_mode)
    }
    // A risk-mode change is itself a change to decision-relevant memory.
    const changed = mutated || (risk_mode !== undefined && risk_mode !== current.risk_mode)
    const pm_rev = changed ? current.pm_rev + 1 : current.pm_rev
    db.prepare("update pm_state set risk_mode = ?, pm_rev = ?, updated_at = ? where project_id = ?").run(
      risk_mode ?? current.risk_mode,
      pm_rev,
      now,
      project_id,
    )
    return {
      ...current,
      pm_rev,
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
      return readState(input.project_id) ?? defaultState(input.project_id)
    },
  )

  export const set_preference = fn(
    z.object({
      project_id: z.string(),
      pref_key: z.string(),
      pref_value: z.string(),
    }),
    async (input) => {
      touch(input.project_id, undefined, true)
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
      touch(input.project_id, undefined, true)
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
      return db
        .prepare(
          `select id, project_id, rule_type, pattern, action, source, created_at
           from pm_constraints
           where project_id = ?
           order by created_at desc, id desc
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
    touch(input.project_id, undefined, true)
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
      const stmt = input.day
        ? db.prepare(
            `select id, project_id, day, title, note, tags, author, session_id, source, created_at
             from pm_dsr
             where project_id = ? and day = ?
             order by created_at desc, id desc
             limit ?`,
          )
        : db.prepare(
            `select id, project_id, day, title, note, tags, author, session_id, source, created_at
             from pm_dsr
             where project_id = ?
             order by created_at desc, id desc
             limit ?`,
          )
      const rows = (
        input.day ? stmt.all(input.project_id, input.day, input.limit) : stmt.all(input.project_id, input.limit)
      ) as Array<{
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
      /**
       * Scope to one session. Filtering in the caller instead means the limit
       * is spent on other sessions' events, so a busy project can return none
       * of the session you asked about while reporting success.
       */
      session_id: z.string().optional(),
      limit: z.number().int().positive().max(500).default(100),
    }),
    async (input) => {
      type EventRow = {
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
      }

      // Built once rather than branched per filter combination; the previous
      // two-branch form duplicated the whole select and would have become four.
      const where = ["project_id = ?"]
      const params: Array<string | number> = [input.project_id]
      if (input.event_type) {
        where.push("event_type = ?")
        params.push(input.event_type)
      }
      if (input.session_id) {
        where.push("session_id = ?")
        params.push(input.session_id)
      }
      params.push(input.limit)

      const rows = db
        .prepare(
          `select id, project_id, session_id, message_id, event_type, payload, policy_hash, contract_hash, pm_rev, created_at
           from pm_rao_event
           where ${where.join(" and ")}
           order by created_at desc, id desc
           limit ?`,
        )
        .all(...params) as EventRow[]

      return rows.map((x) => ({
        ...x,
        payload: JSON.parse(x.payload) as Record<string, unknown>,
      }))
    },
  )

  const MemoryCategory = z.enum(["architecture", "decision", "pattern", "preference", "learning"])
  type MemoryCategory = z.infer<typeof MemoryCategory>

  const SaveMemoryInput = z.object({
    project_id: z.string(),
    category: MemoryCategory,
    title: z.string(),
    content: z.string(),
    tags: z.array(z.string()).optional(),
    session_id: z.string().optional(),
    source: z.enum(["agent", "user", "system"]).default("agent"),
  })

  export const save_memory = fn(SaveMemoryInput, async (input) => {
    touch(input.project_id, undefined, true)
    const now = Date.now()
    const id = ulid()
    db.prepare(
      `insert into pm_memory
        (id, project_id, session_id, category, title, content, tags, source, created_at)
       values
        (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.project_id,
      input.session_id ?? null,
      input.category,
      input.title.trim(),
      input.content.trim(),
      JSON.stringify(input.tags ?? []),
      input.source,
      now,
    )
    log.info("saved memory", { id, project_id: input.project_id, category: input.category })
    return { id, created_at: now }
  })

  const ListMemoryInput = z.object({
    project_id: z.string(),
    category: MemoryCategory.optional(),
    limit: z.number().int().positive().max(200).default(20),
  })

  /**
   * Whether project memory is empty because nothing is worth remembering, or
   * empty because nothing has ever been able to write it.
   *
   * Those are different facts and the caller cannot tell them apart from an empty
   * array. `list_memory` is read on the first message of every session and folded
   * into intent interpretation; while no production code calls `save_memory`, the
   * answer is structurally empty rather than genuinely empty, and a consumer that
   * cannot distinguish the two will report a healthy feature indefinitely.
   */
  export type MemoryHealth = {
    /** Rows currently in the store. */
    active_entries: number
    /**
     * "uninitialised" means the store has never held an entry. It is not a claim
     * that the producer is broken — only that nothing has yet been promoted, which
     * is the honest thing to say while promotion remains an open governance
     * question.
     */
    status: "uninitialised" | "populated"
  }

  export const memory_health = fn(z.object({ project_id: z.string() }), async (input): Promise<MemoryHealth> => {
    const row = db
      .prepare(`select count(*) as n from pm_memory where project_id = ?`)
      .get(input.project_id) as { n: number } | undefined
    const active = row?.n ?? 0
    return { active_entries: active, status: active > 0 ? "populated" : "uninitialised" }
  })

  export const list_memory = fn(ListMemoryInput, async (input) => {
    touch(input.project_id)
    const rows = input.category
      ? (db
          .prepare(
            `select id, project_id, session_id, category, title, content, tags, source, created_at
             from pm_memory
             where project_id = ? and category = ?
             order by created_at desc, id desc
             limit ?`,
          )
          .all(input.project_id, input.category, input.limit) as Array<{
          id: string
          project_id: string
          session_id: string | null
          category: string
          title: string
          content: string
          tags: string
          source: string
          created_at: number
        }>)
      : (db
          .prepare(
            `select id, project_id, session_id, category, title, content, tags, source, created_at
             from pm_memory
             where project_id = ?
             order by created_at desc, id desc
             limit ?`,
          )
          .all(input.project_id, input.limit) as Array<{
          id: string
          project_id: string
          session_id: string | null
          category: string
          title: string
          content: string
          tags: string
          source: string
          created_at: number
        }>)
    return rows.map((x) => ({
      ...x,
      tags: JSON.parse(x.tags) as string[],
    })) as Array<{
      id: string
      project_id: string
      session_id: string | null
      category: MemoryCategory
      title: string
      content: string
      tags: string[]
      source: "agent" | "user" | "system"
      created_at: number
    }>
  })
}
