import { describe, expect, test } from "bun:test"
import {
  hasMemoryContext,
  nextDisplayMode,
  resolveDisplayDetailToggles,
  shouldShowWorkstationPane,
  shouldShowInterventionQueue,
} from "./session-display"

describe("session-display", () => {
  test("cycles display modes in operator -> inspect -> quiet order", () => {
    expect(nextDisplayMode("operator")).toBe("inspect")
    expect(nextDisplayMode("inspect")).toBe("quiet")
    expect(nextDisplayMode("quiet")).toBe("operator")
  })

  test("queue surface is hidden in quiet mode", () => {
    expect(
      shouldShowInterventionQueue({
        displayMode: "quiet",
        queueVisible: true,
      }),
    ).toBe(false)
  })

  test("queue surface respects the operator toggle outside quiet mode", () => {
    expect(
      shouldShowInterventionQueue({
        displayMode: "operator",
        queueVisible: true,
      }),
    ).toBe(true)
    expect(
      shouldShowInterventionQueue({
        displayMode: "inspect",
        queueVisible: false,
      }),
    ).toBe(false)
  })

  test("inspect mode deepens detail visibility without changing thinking or timestamps", () => {
    expect(
      resolveDisplayDetailToggles({
        displayMode: "inspect",
        showThinking: false,
        showTimestamps: true,
        showDetails: false,
        showAssistantMetadata: false,
      }),
    ).toEqual({
      showThinking: false,
      showTimestamps: true,
      showDetails: true,
      showAssistantMetadata: true,
    })
  })

  test("quiet mode suppresses all secondary session chrome", () => {
    expect(
      resolveDisplayDetailToggles({
        displayMode: "quiet",
        showThinking: true,
        showTimestamps: true,
        showDetails: true,
        showAssistantMetadata: true,
      }),
    ).toEqual({
      showThinking: false,
      showTimestamps: false,
      showDetails: false,
      showAssistantMetadata: false,
    })
  })

  test("quiet mode hides workstation pane unless critical intervention is present", () => {
    expect(
      shouldShowWorkstationPane({
        displayMode: "quiet",
        paneVisibility: "auto",
        hasCriticalIntervention: false,
        hasAuditNeed: false,
        hasRefineNeed: false,
      }),
    ).toBe(false)

    expect(
      shouldShowWorkstationPane({
        displayMode: "quiet",
        paneVisibility: "auto",
        hasCriticalIntervention: true,
        hasAuditNeed: false,
        hasRefineNeed: false,
      }),
    ).toBe(true)
  })

  test("refine drafts do not auto-open the workstation pane in operator mode", () => {
    expect(
      shouldShowWorkstationPane({
        displayMode: "operator",
        paneVisibility: "auto",
        hasCriticalIntervention: false,
        hasAuditNeed: false,
        hasRefineNeed: true,
      }),
    ).toBe(false)

    expect(
      shouldShowWorkstationPane({
        displayMode: "quiet",
        paneVisibility: "hidden",
        hasCriticalIntervention: false,
        hasAuditNeed: false,
        hasRefineNeed: true,
      }),
    ).toBe(false)
  })

  test("a pinned workstation pane remains visible even without active interventions", () => {
    expect(
      shouldShowWorkstationPane({
        displayMode: "operator",
        paneVisibility: "pinned",
        hasCriticalIntervention: false,
        hasAuditNeed: false,
        hasRefineNeed: false,
      }),
    ).toBe(true)
  })

  test("auto mode opens the rail for audit need but hidden mode still respects the user choice", () => {
    expect(
      shouldShowWorkstationPane({
        displayMode: "operator",
        paneVisibility: "auto",
        hasCriticalIntervention: false,
        hasAuditNeed: true,
        hasRefineNeed: false,
      }),
    ).toBe(true)

    // hidden mode respects user choice for non-critical context
    expect(
      shouldShowWorkstationPane({
        displayMode: "operator",
        paneVisibility: "hidden",
        hasCriticalIntervention: false,
        hasAuditNeed: true,
        hasRefineNeed: true,
      }),
    ).toBe(false)
  })

  test("critical interventions override hidden visibility so pending approvals are never silently buried", () => {
    expect(
      shouldShowWorkstationPane({
        displayMode: "operator",
        paneVisibility: "hidden",
        hasCriticalIntervention: true,
        hasAuditNeed: false,
        hasRefineNeed: false,
      }),
    ).toBe(true)
  })

  test("memory context derives from reflection or PM snapshots", () => {
    expect(
      hasMemoryContext({
        reflectionPresent: false,
        reflectionHistoryCount: 0,
        pmListCount: 0,
        pmRuleCount: 0,
      }),
    ).toBe(false)

    expect(
      hasMemoryContext({
        reflectionPresent: true,
        reflectionHistoryCount: 0,
        pmListCount: 0,
        pmRuleCount: 0,
      }),
    ).toBe(true)

    expect(
      hasMemoryContext({
        reflectionPresent: false,
        reflectionHistoryCount: 0,
        pmListCount: 2,
        pmRuleCount: 0,
      }),
    ).toBe(true)
  })
})
