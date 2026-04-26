import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { writeFile, unlink, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DaxCoreError } from "@/rust/core"
import { readReplayEventsFile, formatReplayProof, verifyReplayEvents } from "./replay"

let tmpDir: string
let validEventsPath: string
let invalidStatusPath: string
let notArrayPath: string

const VALID_EVENTS = [
  { eventId: "e1", sequence: 1, cursor: "c1", runId: "run_t1", timestamp: "2026-04-26T10:00:01Z", type: "run.created",   payload: { status: "created" } },
  { eventId: "e2", sequence: 2, cursor: "c2", runId: "run_t1", timestamp: "2026-04-26T10:00:02Z", type: "run.started",   payload: { status: "running" } },
  { eventId: "e3", sequence: 3, cursor: "c3", runId: "run_t1", timestamp: "2026-04-26T10:00:03Z", type: "run.completed", payload: { status: "completed", summaryAvailable: true } },
]

const INVALID_TRANSITION_EVENTS = [
  { eventId: "e1", sequence: 1, cursor: "c1", runId: "run_bad", timestamp: "2026-04-26T10:00:01Z", type: "run.created",      payload: { status: "created" } },
  { eventId: "e2", sequence: 2, cursor: "c2", runId: "run_bad", timestamp: "2026-04-26T10:00:02Z", type: "run.state_changed", payload: { previousStatus: "created", currentStatus: "completed", reason: "skip" } },
]

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "dax-verify-"))
  validEventsPath   = join(tmpDir, "valid.events.json")
  invalidStatusPath = join(tmpDir, "invalid.events.json")
  notArrayPath      = join(tmpDir, "not-array.json")

  await writeFile(validEventsPath, JSON.stringify(VALID_EVENTS))
  await writeFile(invalidStatusPath, JSON.stringify(INVALID_TRANSITION_EVENTS))
  await writeFile(notArrayPath, JSON.stringify({ type: "not-an-array" }))
})

afterAll(async () => {
  await Promise.all([validEventsPath, invalidStatusPath, notArrayPath].map((f) => unlink(f).catch(() => {})))
})

describe("readReplayEventsFile", () => {
  test("reads and parses a valid events file", async () => {
    const events = await readReplayEventsFile(validEventsPath)
    expect(events).toHaveLength(3)
  })

  test("throws a clear error when file does not exist", async () => {
    await expect(readReplayEventsFile(join(tmpDir, "missing.json"))).rejects.toThrow("Cannot read events file")
  })

  test("throws when file is not a JSON array", async () => {
    await expect(readReplayEventsFile(notArrayPath)).rejects.toThrow("must contain a JSON array")
  })
})

describe("formatReplayProof", () => {
  test("formats a passing proof report", () => {
    const output = formatReplayProof({
      schemaVersion: "dax.core.proof.v1",
      result: "pass",
      eventCount: 3,
      finalStatus: "completed",
      stateHash: "sha256:abc",
      eventSequenceHash: "sha256:def",
    })

    expect(output).toContain("DAX Replay Verification")
    expect(output).toContain("Result:               pass")
    expect(output).toContain("Events:               3")
    expect(output).toContain("Final status:         completed")
    expect(output).toContain("sha256:abc")
    expect(output).toContain("replayed successfully")
  })

  test("formats a failing proof report", () => {
    const output = formatReplayProof({
      schemaVersion: "dax.core.proof.v1",
      result: "fail",
      eventCount: 2,
      eventSequenceHash: "sha256:xyz",
      error: "illegal transition",
    })

    expect(output).toContain("Result:               fail")
    expect(output).toContain("Error: illegal transition")
    expect(output).not.toContain("replayed successfully")
  })
})

describe("verifyReplayEvents", () => {
  test(
    "returns a passing proof for a valid event log",
    async () => {
      const result = await verifyReplayEvents(VALID_EVENTS, { includeState: false })

      expect(result.proof.result).toBe("pass")
      expect(result.proof.eventCount).toBe(3)
      expect(result.proof.stateHash).toMatch(/^sha256:/)
      expect(result.includeState).toBe(false)
    },
    60_000,
  )

  test(
    "returns proof and state when includeState is true",
    async () => {
      const result = await verifyReplayEvents(VALID_EVENTS, { includeState: true })

      expect(result.includeState).toBe(true)
      if (result.includeState) {
        expect(result.state.status).toBe("completed")
        expect(result.state.runId).toBe("run_t1")
      }
    },
    60_000,
  )

  test(
    "surfaces illegal-transition failures as DaxCoreError",
    async () => {
      await expect(verifyReplayEvents(INVALID_TRANSITION_EVENTS, { includeState: false })).rejects.toBeInstanceOf(
        DaxCoreError,
      )
    },
    60_000,
  )
})
