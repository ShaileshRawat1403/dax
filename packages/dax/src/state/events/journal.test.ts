import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import z from "zod"
import { Storage } from "@/storage/storage"
import { acquireRunLock } from "@/util/fs-lock"
import { Journal } from "./journal"

const owner = "project_test"
const key = ["project_events", owner]
const EventSchema = z.object({
  eventId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  scopeType: z.literal("project"),
  scopeId: z.literal(owner),
  schemaVersion: z.literal("v1"),
  type: z.literal("fact"),
  payload: z.object({ value: z.string() }).strict(),
  commandId: z.string().optional(),
}).strict()
type Event = z.infer<typeof EventSchema>
type Input = { value: string; commandId?: string; eventId?: string }

function journal() {
  return new Journal<Event, Input>({
    scope: { type: "project", id: owner },
    path: key,
    lock: () => acquireRunLock("journal_primitive_test"),
    parse: (events) => events.map((event) => EventSchema.parse(event)),
    create: (seq, input) => ({
      eventId: input.eventId ?? `evt_${crypto.randomUUID()}`,
      seq,
      scopeType: "project",
      scopeId: owner,
      schemaVersion: "v1",
      type: "fact",
      payload: { value: input.value },
      ...(input.commandId ? { commandId: input.commandId } : {}),
    }),
    staleError: (expected, actual) => new Error(`stale ${expected}/${actual}`),
    duplicateError: (commandId) => new Error(`duplicate ${commandId}`),
  })
}

async function rejection(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation
  } catch (error) {
    if (error instanceof Error) return error
    throw error
  }
  throw new Error("Expected the operation to reject")
}

let testHome: string
let previousHome: string | undefined
beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  testHome = await mkdtemp(path.join(os.tmpdir(), "dax-journal-primitive-"))
  process.env.DAX_TEST_HOME = testHome
})
afterEach(async () => {
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  await rm(testHome, { recursive: true, force: true })
})

describe("shared journal storage protocol", () => {
  test("concurrent tail appends serialize and explicit stale writes fail", async () => {
    const store = journal()
    const written = await Promise.all(Array.from({ length: 12 }, (_, i) => store.appendAtTail({ value: `${i}` })))
    expect(written.map((event) => event.seq).toSorted((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i))
    expect((await store.read()).map((event) => event.seq)).toEqual(Array.from({ length: 12 }, (_, i) => i))
    expect((await rejection(store.append(0, { value: "stale" }))).message).toContain("stale 0/12")
    expect(await store.read()).toHaveLength(12)
  })

  test("duplicate commands are idempotent by default and reject when requested", async () => {
    const store = journal()
    const original = await store.appendAtTail({ value: "first", commandId: "cmd_1" })
    expect(await store.appendAtTail({ value: "second", commandId: "cmd_1" })).toEqual(original)
    expect((await rejection(store.appendAtTail({ value: "second", commandId: "cmd_1" }, { rejectDuplicateCommand: true }))).message).toContain("duplicate cmd_1")
    expect(await store.read()).toEqual([original])
  })

  test("a repeated event ID is rejected before publication", async () => {
    const store = journal()
    const original = await store.appendAtTail({ value: "first", eventId: "evt_fixed" })
    expect((await rejection(store.appendAtTail({ value: "second", eventId: "evt_fixed" }))).message).toContain("repeats eventId")
    expect(await store.read()).toEqual([original])
  })

  test("malformed owners, duplicate IDs, and sequence gaps refuse replay", async () => {
    const store = journal()
    const valid = await store.appendAtTail({ value: "first" })
    for (const corrupt of [
      [{ ...valid, scopeId: "other" }],
      [valid, { ...valid, seq: 1 }],
      [{ ...valid, seq: 3 }],
    ]) {
      await Storage.write([...key, "events.json"], corrupt)
      expect(await rejection(store.read())).toBeInstanceOf(Error)
      expect(await rejection(store.appendAtTail({ value: "second" }))).toBeInstanceOf(Error)
      expect(await Storage.read<unknown[]>([...key, "events.json"])).toEqual(corrupt)
    }
  })

  test("unpublished temp files and failed rename never become a journal event", async () => {
    const store = journal()
    const original = await store.appendAtTail({ value: "first" })
    await Storage.write([...key, "events.json.tmp"], [original, { seq: 1 }])
    expect(await store.read()).toEqual([original])

    const rename = spyOn(Storage, "rename").mockRejectedValueOnce(new Error("forced rename failure"))
    try {
      expect((await rejection(store.appendAtTail({ value: "second" }))).message).toContain("forced rename failure")
      expect(await store.read()).toEqual([original])
    } finally {
      rename.mockRestore()
    }
  })

  test("a killed publisher leaves the previous journal readable and retryable", async () => {
    const store = journal()
    const original = await store.appendAtTail({ value: "first" })
    const childCode = `
      const { Storage } = await import(${JSON.stringify(path.join(import.meta.dir, "../../storage/storage.ts"))});
      const { Journal } = await import(${JSON.stringify(path.join(import.meta.dir, "journal.ts"))});
      const { acquireRunLock } = await import(${JSON.stringify(path.join(import.meta.dir, "../../util/fs-lock.ts"))});
      const store = new Journal({
        scope: { type: "project", id: "project_test" },
        path: ["project_events", "project_test"],
        lock: () => acquireRunLock("journal_primitive_test"),
        parse: (events) => events,
        create: (seq) => ({ eventId: "evt_interrupted", seq, scopeType: "project", scopeId: "project_test", schemaVersion: "v1", type: "fact", payload: { value: "interrupted" } }),
        staleError: () => new Error("stale"),
        duplicateError: () => new Error("duplicate"),
      });
      Storage.rename = async () => {
        process.stderr.write("JOURNAL_READY\\n");
        await new Promise(() => {});
      };
      await store.appendAtTail({});
    `
    const child = Bun.spawn([process.execPath, "-e", childCode], {
      cwd: path.resolve(import.meta.dir, "../../../../.."),
      env: { ...process.env, DAX_TEST_HOME: testHome },
      stdout: "pipe",
      stderr: "pipe",
    })
    try {
      const reader = child.stderr.getReader()
      let output = ""
      while (!output.includes("JOURNAL_READY")) {
        const next = await Promise.race([
          reader.read(),
          Bun.sleep(5_000).then(() => { throw new Error(`Timed out waiting for child publication boundary: ${output}`) }),
        ])
        if (next.done) throw new Error(`Child exited before publication boundary: ${output}`)
        output += new TextDecoder().decode(next.value)
      }
    } finally {
      child.kill()
      await child.exited
    }
    expect(await store.read()).toEqual([original])
    expect((await store.appendAtTail({ value: "retry" })).seq).toBe(1)
    expect((await store.read()).map((event) => event.payload.value)).toEqual(["first", "retry"])
  })
})
