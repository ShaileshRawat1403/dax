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

  test("operator auto mode stays closed for audit need (contract: audit is user-initiated)", () => {
    // DAX UI Interaction Contract v0.1 Section 6: audit findings are
    // user-initiated, not auto-open. Operator mode stays calm by default;
    // only critical intervention or an explicit user pin opens the pane.
    expect(
      shouldShowWorkstationPane({
        displayMode: "operator",
        paneVisibility: "auto",
        hasCriticalIntervention: false,
        hasAuditNeed: true,
        hasRefineNeed: false,
      }),
    ).toBe(false)

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

  test("inspect auto mode still opens the pane for audit and refine needs", () => {
    // Inspect mode is the operator explicitly asking for deeper inspection,
    // so secondary attention signals are allowed to auto-open the pane.
    expect(
      shouldShowWorkstationPane({
        displayMode: "inspect",
        paneVisibility: "auto",
        hasCriticalIntervention: false,
        hasAuditNeed: true,
        hasRefineNeed: false,
      }),
    ).toBe(true)

    expect(
      shouldShowWorkstationPane({
        displayMode: "inspect",
        paneVisibility: "auto",
        hasCriticalIntervention: false,
        hasAuditNeed: false,
        hasRefineNeed: true,
      }),
    ).toBe(true)

    expect(
      shouldShowWorkstationPane({
        displayMode: "inspect",
        paneVisibility: "auto",
        hasCriticalIntervention: false,
        hasAuditNeed: false,
        hasRefineNeed: false,
      }),
    ).toBe(false)
  })

  test("pinned visibility opens the pane in operator mode even without attention", () => {
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

  test("critical intervention always opens the pane, including operator auto mode", () => {
    expect(
      shouldShowWorkstationPane({
        displayMode: "operator",
        paneVisibility: "auto",
        hasCriticalIntervention: true,
        hasAuditNeed: false,
        hasRefineNeed: false,
      }),
    ).toBe(true)
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
