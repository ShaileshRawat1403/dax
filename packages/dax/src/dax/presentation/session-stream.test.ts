import { describe, expect, it } from "bun:test"
import {
  buildStreamItems,
  getCurrentPhase,
  getActivePhases,
  PHASE_ORDER,
  getPhaseLabel,
  type RenderableStreamItem,
  type RunPhase,
} from "./session-stream"
import type { ProjectedRun } from "@/server/run-contract"

function createMockProjectedRun(
  narrativeTypes: Array<{ type: string; message: string; timestamp?: string }>,
): ProjectedRun {
  return {
    header: {
      runId: "run-123",
      title: "Test Run",
      status: "running",
      createdAt: "2026-04-08T10:00:00Z",
      updatedAt: "2026-04-08T10:00:00Z",
    },
    summary: undefined,
    narrative: narrativeTypes.map((n, i) => ({
      id: `narrative-${i}`,
      type: n.type,
      message: n.message,
      timestamp: n.timestamp ?? `2026-04-08T10:0${i}:00Z`,
      metadata: {},
    })),
    approvals: [],
    artifacts: [],
    interventions: [],
    proposedChanges: [],
  }
}

function createMockMessages(roles: Array<"user" | "assistant">): any[] {
  return roles.map((role, i) => ({
    id: `msg-${i}`,
    role,
    sessionID: "session-123",
    time: { created: Date.now() + i * 1000, completed: role === "assistant" ? Date.now() + i * 1000 + 500 : undefined },
    agent: role === "assistant" ? "dax" : undefined,
    model: role === "assistant" ? { providerID: "google", modelID: "gemini-2.5" } : undefined,
  }))
}

function createContextToolPart(id: string, tool: string, target: string) {
  return {
    id,
    type: "tool" as const,
    callID: `call-${id}`,
    tool,
    state: {
      status: "completed" as const,
      input: {},
      output: "",
      title: "",
      metadata: { target },
      time: {
        start: Date.now(),
        end: Date.now() + 10,
      },
    },
  }
}

function createTextPart(id: string, text: string) {
  return {
    id,
    type: "text" as const,
    text,
  }
}

function createReasoningPart(id: string, text: string) {
  return {
    id,
    type: "reasoning" as const,
    text,
  }
}

describe("session-stream presentation model", () => {
  describe("buildStreamItems", () => {
    it("returns empty array when no projectedRun and no messages", () => {
      const items = buildStreamItems(undefined, [], {})
      expect(items).toEqual([])
    })

    it("returns legacy messages when no projectedRun exists", () => {
      const messages = createMockMessages(["user", "assistant"])
      const items = buildStreamItems(undefined, messages, {})

      expect(items.length).toBe(2)
      expect(items[0].kind).toBe("message.user")
      expect(items[1].kind).toBe("message.assistant")
    })

    it("merges consecutive assistant context-evidence messages into one stream block", () => {
      const messages = createMockMessages(["assistant", "assistant"])
      const items = buildStreamItems(undefined, messages, {
        "msg-0": [createContextToolPart("tool-0", "read", "CHANGELOG.md") as any],
        "msg-1": [createContextToolPart("tool-1", "glob", "**/package.json") as any],
      })

      expect(items).toHaveLength(1)
      expect(items[0]?.kind).toBe("message.assistant")
      expect(items[0]?.parts).toHaveLength(2)
    })

    it("merges same-agent tool turn with a subsequent text response into one block", () => {
      // The model thinks across multiple turns: tool use followed by final answer.
      // Both turns are from the same agent so they merge into a single continuous block.
      const messages = createMockMessages(["assistant", "assistant"])
      const items = buildStreamItems(undefined, messages, {
        "msg-0": [createContextToolPart("tool-0", "read", "CHANGELOG.md") as any],
        "msg-1": [createTextPart("text-1", "Here is the release-readiness verdict.") as any],
      })

      expect(items).toHaveLength(1)
      expect(items[0]?.kind).toBe("message.assistant")
      expect(items[0]?.parts?.map((p) => p.type)).toEqual(["tool", "text"])
    })

    it("merges adjacent planner helper packets into one assistant block", () => {
      const messages = createMockMessages(["assistant", "assistant", "assistant"])
      const items = buildStreamItems(undefined, messages, {
        "msg-0": [createContextToolPart("tool-0", "read", "CHANGELOG.md") as any],
        "msg-1": [createReasoningPart("reasoning-1", "Planning release readiness checks.") as any],
        "msg-2": [createContextToolPart("tool-2", "glob", "**/RELEASE*.md") as any],
      })

      expect(items).toHaveLength(1)
      expect(items[0]?.kind).toBe("message.assistant")
      expect(items[0]?.parts?.map((part) => part.type)).toEqual(["tool", "reasoning", "tool"])
    })

    it("merges tool, reasoning, and answer turns from the same agent into one continuous block", () => {
      // All three turns are the same agent's work: gather context → think → respond.
      // The merged block preserves part order so the stream reads as a single narrative.
      const messages = createMockMessages(["assistant", "assistant", "assistant"])
      const items = buildStreamItems(undefined, messages, {
        "msg-0": [createContextToolPart("tool-0", "read", "CHANGELOG.md") as any],
        "msg-1": [createReasoningPart("reasoning-1", "Planning release readiness checks.") as any],
        "msg-2": [createTextPart("text-2", "Release readiness is blocked pending verification receipts.") as any],
      })

      expect(items).toHaveLength(1)
      expect(items[0]?.parts?.map((part) => part.type)).toEqual(["tool", "reasoning", "text"])
    })

    it("renders projected narrative items when projectedRun exists", () => {
      const projectedRun = createMockProjectedRun([
        { type: "run.created", message: "Session initialized" },
        { type: "intent.created", message: "Target identified: fix auth" },
        { type: "plan.compiled", message: "Strategy locked: 3 tasks mapped" },
      ])

      const items = buildStreamItems(projectedRun, [], {})

      // 2 phase markers (understanding, planning) + 1 run event (intent.created)
      expect(items.length).toBe(3)

      const runEvents = items.filter((item) => item.kind === "run.event")
      expect(runEvents.length).toBe(1)

      // intent.created surfaces under UNDERSTANDING; run.created is never a run event
      const runCreated = runEvents.find((item) => item.type === "run.created")
      expect(runCreated).toBeUndefined()
      const intentCreated = runEvents.find((item) => item.type === "intent.created")
      expect(intentCreated).toBeDefined() // surfaces agent's interpretation under UNDERSTANDING
      const planCompiled = runEvents.find((item) => item.type === "plan.compiled")
      expect(planCompiled).toBeUndefined()
    })

    it("renders phase markers for structural narrative items", () => {
      const projectedRun = createMockProjectedRun([
        { type: "run.created", message: "Session initialized" },
        { type: "plan.compiled", message: "Strategy locked" },
        { type: "step.started", message: "Executing: Task 1" },
      ])

      const items = buildStreamItems(projectedRun, [], {})

      const phaseMarkers = items.filter((item) => item.kind === "phase.marker")
      expect(phaseMarkers.length).toBeGreaterThanOrEqual(2)

      expect(phaseMarkers.some((m) => m.phase === "understanding")).toBe(true)
      expect(phaseMarkers.some((m) => m.phase === "planning")).toBe(true)
      expect(phaseMarkers.some((m) => m.phase === "executing")).toBe(true)
    })

    it("renders alert items for intervention.required", () => {
      const projectedRun = createMockProjectedRun([
        { type: "intervention.required", message: "Needs direction: ambiguous target" },
      ])

      const items = buildStreamItems(projectedRun, [], {})

      const alertItems = items.filter((item) => item.kind === "alert.inline")
      expect(alertItems.length).toBe(1)
      expect(alertItems[0].message).toBe("Needs direction: ambiguous target")
      expect(alertItems[0].status).toBe("pending")
    })

    it("renders alert items for approval.requested", () => {
      const projectedRun = createMockProjectedRun([
        { type: "approval.requested", message: "Policy Gate: Write to production (HIGH RISK)" },
      ])

      const items = buildStreamItems(projectedRun, [], {})

      const alertItems = items.filter((item) => item.kind === "alert.inline")
      expect(alertItems.length).toBe(1)
      expect(alertItems[0].message).toBe("Policy Gate: Write to production (HIGH RISK)")
    })

    it("renders both projected narrative and messages together", () => {
      const projectedRun = createMockProjectedRun([
        { type: "run.created", message: "Session initialized" },
        { type: "plan.compiled", message: "Strategy locked" },
      ])

      const messages = createMockMessages(["user", "assistant"])
      const items = buildStreamItems(projectedRun, messages, {})

      const runEvents = items.filter((item) => item.kind === "run.event")
      const messageItems = items.filter((item) => item.kind === "message.user" || item.kind === "message.assistant")

      expect(runEvents.length).toBe(0)
      expect(messageItems.length).toBe(2)

      const sortedByTimestamp = items.toSorted((a, b) => a.timestamp - b.timestamp)
      const firstItem = sortedByTimestamp[0]

      expect(firstItem.timestamp).toBeLessThanOrEqual(Date.now())
    })

    it("never returns an empty stream when projectedRun has non-trivial work", () => {
      // run.created-only is intentionally suppressed (trivial query, no plan/step events).
      // Use a narrative with actual work to verify the regression guard.
      const projectedRun = createMockProjectedRun([
        { type: "run.created", message: "Session initialized" },
        { type: "plan.compiled", message: "Strategy locked" },
      ])

      const items = buildStreamItems(projectedRun, [], {})

      expect(items.length).toBeGreaterThan(0)
      expect(items.some((item) => item.kind === "run.event" || item.kind === "phase.marker")).toBe(true)
    })

    it("UNDERSTANDING block never appears before the first user message", () => {
      // Regression: intent.created has an earlier server timestamp than the user message,
      // so after sort it floated to index 0 as a detached IntentBlock above everything.
      const projectedRun = createMockProjectedRun([
        { type: "run.created", message: "Session", timestamp: "2026-04-17T06:00:00Z" },
        { type: "intent.created", message: "hello DAX", timestamp: "2026-04-17T06:00:01Z" },
        { type: "plan.compiled", message: "Plan", timestamp: "2026-04-17T06:00:05Z" },
        { type: "step.started", message: "Execute", timestamp: "2026-04-17T06:00:06Z" },
      ])
      // User message has a later timestamp than run.created/intent.created
      const messages = [
        {
          id: "msg-user",
          role: "user",
          sessionID: "s",
          time: { created: new Date("2026-04-17T06:00:03Z").getTime() },
        },
      ]

      const items = buildStreamItems(projectedRun, messages, {})

      const firstUserIdx = items.findIndex((item) => item.kind === "message.user")
      const understandingMarkerIdx = items.findIndex(
        (item) => item.kind === "phase.marker" && item.phase === "understanding",
      )
      const intentEventIdx = items.findIndex((item) => item.kind === "run.event" && item.type === "intent.created")

      // Both the phase marker and intent event must appear AFTER the user message
      expect(understandingMarkerIdx).toBeGreaterThan(firstUserIdx)
      expect(intentEventIdx).toBeGreaterThan(firstUserIdx)
      // Phase marker must appear before its run.event children
      expect(understandingMarkerIdx).toBeLessThan(intentEventIdx)
    })

    it("sorts all items by timestamp", () => {
      const projectedRun = createMockProjectedRun([
        { type: "run.created", message: "First", timestamp: "2026-04-08T10:00:00Z" },
        { type: "step.started", message: "Third", timestamp: "2026-04-08T10:02:00Z" },
        { type: "plan.compiled", message: "Second", timestamp: "2026-04-08T10:01:00Z" },
      ])

      const items = buildStreamItems(projectedRun, [], {})

      const timestamps = items.map((item) => item.timestamp)
      const sortedTimestamps = [...timestamps].sort((a, b) => a - b)
      expect(timestamps).toEqual(sortedTimestamps)
    })
  })

  describe("getCurrentPhase", () => {
    it("returns 'executing' as default when no items", () => {
      const phase = getCurrentPhase([])
      expect(phase).toBe("executing")
    })

    it("returns the active phase when a phase marker is active", () => {
      const items: RenderableStreamItem[] = [
        {
          id: "phase-1",
          kind: "phase.marker",
          timestamp: Date.now() - 1000,
          phase: "planning",
          status: "completed",
        },
        {
          id: "phase-2",
          kind: "phase.marker",
          timestamp: Date.now(),
          phase: "executing",
          status: "active",
        },
      ]

      const phase = getCurrentPhase(items)
      expect(phase).toBe("executing")
    })

    it("returns 'executing' when no active phase marker but has active run event", () => {
      const items: RenderableStreamItem[] = [
        {
          id: "event-1",
          kind: "run.event",
          timestamp: Date.now(),
          phase: "executing",
          type: "step.started",
          status: "active",
        },
      ]

      const phase = getCurrentPhase(items)
      expect(phase).toBe("executing")
    })
  })

  describe("getActivePhases", () => {
    it("returns 'executing' as default when no items", () => {
      const phases = getActivePhases([])
      expect(phases.has("executing")).toBe(true)
      expect(phases.size).toBe(1)
    })

    it("returns only truly active phase marker", () => {
      const items: RenderableStreamItem[] = [
        {
          id: "phase-1",
          kind: "phase.marker",
          timestamp: Date.now() - 1000,
          phase: "planning",
          status: "completed",
        },
        {
          id: "phase-2",
          kind: "phase.marker",
          timestamp: Date.now(),
          phase: "executing",
          status: "active",
        },
      ]

      const phases = getActivePhases(items)
      expect(phases.has("executing")).toBe(true)
      expect(phases.has("planning")).toBe(false)
    })

    it("returns phase with active run event", () => {
      const items: RenderableStreamItem[] = [
        {
          id: "event-1",
          kind: "run.event",
          timestamp: Date.now(),
          phase: "executing",
          type: "step.started",
          status: "active",
        },
      ]

      const phases = getActivePhases(items)
      expect(phases.has("executing")).toBe(true)
    })

    it("returns phase with pending alert", () => {
      const items: RenderableStreamItem[] = [
        {
          id: "alert-1",
          kind: "alert.inline",
          timestamp: Date.now(),
          phase: "planning",
          type: "approval.requested",
          status: "pending",
        },
      ]

      const phases = getActivePhases(items)
      expect(phases.has("planning")).toBe(true)
    })
  })

  describe("PHASE_ORDER and getPhaseLabel", () => {
    it("has correct phase order", () => {
      expect(PHASE_ORDER).toEqual(["understanding", "planning", "executing", "verifying", "complete"])
    })

    it("returns correct labels for each phase", () => {
      expect(getPhaseLabel("understanding")).toBe("Understanding")
      expect(getPhaseLabel("planning")).toBe("Planning")
      expect(getPhaseLabel("executing")).toBe("Executing")
      expect(getPhaseLabel("verifying")).toBe("Verifying")
      expect(getPhaseLabel("complete")).toBe("Complete")
    })
  })

  describe("regression: narrative rendering never blanks", () => {
    it("run.created-only narrative is suppressed for trivial queries", () => {
      // A narrative with only run.created has no plan/step events — it's a trivial
      // interaction. All phase markers are intentionally suppressed to keep the stream clean.
      const projectedRun = createMockProjectedRun([{ type: "run.created", message: "Session initialized" }])

      const items = buildStreamItems(projectedRun, [], {})

      const visibleItems = items.filter(
        (item) => item.kind === "run.event" || item.kind === "phase.marker" || item.kind === "alert.inline",
      )
      expect(visibleItems.length).toBe(0)
    })

    it("only plan.compiled narrative item still renders visible rows", () => {
      const projectedRun = createMockProjectedRun([{ type: "plan.compiled", message: "Strategy locked: 5 tasks" }])

      const items = buildStreamItems(projectedRun, [], {})

      expect(items.length).toBeGreaterThan(0)

      const visibleItems = items.filter(
        (item) => item.kind === "run.event" || item.kind === "phase.marker" || item.kind === "alert.inline",
      )
      expect(visibleItems.length).toBeGreaterThan(0)
      expect(visibleItems.some((item) => item.kind === "phase.marker")).toBe(true)
      expect(visibleItems.some((item) => item.kind === "run.event")).toBe(false)
    })

    it("mixed narrative types all render correctly", () => {
      const projectedRun = createMockProjectedRun([
        { type: "run.created", message: "Session initialized" },
        { type: "intent.created", message: "Target identified" },
        { type: "plan.compiled", message: "Strategy locked" },
        { type: "step.started", message: "Executing task" },
        { type: "step.completed", message: "Task done" },
        { type: "approval.requested", message: "Approval needed" },
        { type: "run.completed", message: "Goal reached" },
      ])

      const items = buildStreamItems(projectedRun, [], {})

      // 4 phase markers (understanding, planning, executing, complete)
      // + 1 run event (intent.created — only errors and intent prose surface)
      // + 1 alert.inline (approval.requested)
      // step.started, step.completed, run.completed are NOT rendered as rows —
      // phase markers and the rail summary communicate completion
      expect(items.length).toBe(6)

      const runEvents = items.filter((item) => item.kind === "run.event")
      const phaseMarkers = items.filter((item) => item.kind === "phase.marker")
      const alertItems = items.filter((item) => item.kind === "alert.inline")

      expect(runEvents.length).toBe(1)
      expect(phaseMarkers.length).toBe(4)
      expect(alertItems.length).toBe(1)
      // intent.created surfaces the agent's interpretation under UNDERSTANDING
      expect(runEvents.some((item) => item.type === "intent.created")).toBe(true)
      // step rows are suppressed — steps are counted in phase rail summary only
      expect(runEvents.some((item) => item.type === "step.started")).toBe(false)
      expect(runEvents.some((item) => item.type === "step.completed")).toBe(false)
      expect(runEvents.some((item) => item.type === "plan.compiled")).toBe(false)
      // run.completed is communicated by the COMPLETE phase marker, not a separate row
      expect(runEvents.some((item) => item.type === "run.completed")).toBe(false)
    })
  })

  describe("compaction handling", () => {
    function createCompactionUserMessage(id: string) {
      return {
        id,
        role: "user" as const,
        sessionID: "session-123",
        time: { created: Date.now(), completed: undefined },
        agent: undefined,
        model: undefined,
      }
    }

    function createCompactionAssistantMessage(id: string, mode: "compaction" | undefined = "compaction") {
      return {
        id,
        role: "assistant" as const,
        sessionID: "session-123",
        time: { created: Date.now() + 100, completed: Date.now() + 200 },
        agent: "compaction",
        mode,
        summary: true,
        model: undefined,
      }
    }

    it("emits a compaction.marker for a user message containing only a compaction part", () => {
      const msg = createCompactionUserMessage("msg-compact")
      const parts: Record<string, any[]> = {
        "msg-compact": [{ type: "compaction" }],
      }
      const items = buildStreamItems(undefined, [msg], parts)

      expect(items).toHaveLength(1)
      expect(items[0]?.kind).toBe("compaction.marker")
      expect(items[0]?.id).toBe("compaction-msg-compact")
      expect(items[0]?.status).toBe("completed")
    })

    it("does not emit compaction.marker when the user message also has a real text part", () => {
      const msg = createCompactionUserMessage("msg-mixed")
      const parts: Record<string, any[]> = {
        "msg-mixed": [
          { type: "compaction" },
          { type: "text", text: "Summarize what we've done so far", synthetic: false },
        ],
      }
      const items = buildStreamItems(undefined, [msg], parts)

      expect(items).toHaveLength(1)
      expect(items[0]?.kind).toBe("message.user")
    })

    it("does not emit compaction.marker for synthetic text parts alongside compaction", () => {
      const msg = createCompactionUserMessage("msg-synthetic")
      const parts: Record<string, any[]> = {
        "msg-synthetic": [
          { type: "compaction" },
          { type: "text", text: "[internal trigger]", synthetic: true },
        ],
      }
      const items = buildStreamItems(undefined, [msg], parts)

      // synthetic text doesn't count as a real text part — should still be a marker
      expect(items).toHaveLength(1)
      expect(items[0]?.kind).toBe("compaction.marker")
    })

    it("filters out compaction summary assistant messages from the stream", () => {
      const userMsg = {
        id: "msg-user",
        role: "user" as const,
        sessionID: "session-123",
        time: { created: Date.now() },
      }
      const compactionAssistant = createCompactionAssistantMessage("msg-compact-assistant")
      const realAssistant = {
        id: "msg-real",
        role: "assistant" as const,
        sessionID: "session-123",
        time: { created: Date.now() + 300, completed: Date.now() + 400 },
        agent: "dax",
        model: { providerID: "anthropic", modelID: "claude-3-5" },
      }

      const items = buildStreamItems(undefined, [userMsg, compactionAssistant, realAssistant], {})

      // Should have exactly 2 items: user + real assistant (compaction assistant filtered out)
      expect(items).toHaveLength(2)
      expect(items[0]?.kind).toBe("message.user")
      expect(items[1]?.kind).toBe("message.assistant")
      // The real assistant (not the compaction one) must be the one rendered
      expect((items[1]?.data as any)?.agent).toBe("dax")
    })

    it("compaction.marker has status completed and no phase", () => {
      const msg = createCompactionUserMessage("msg-chk")
      const parts: Record<string, any[]> = {
        "msg-chk": [{ type: "compaction" }],
      }
      const items = buildStreamItems(undefined, [msg], parts)

      expect(items[0]?.status).toBe("completed")
      expect(items[0]?.phase).toBeUndefined()
    })
  })
})
