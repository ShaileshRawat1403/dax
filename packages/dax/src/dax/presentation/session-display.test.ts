import { describe, expect, test } from "bun:test"
import {
  hasMemoryContext,
  nextDisplayMode,
  resolveDisplayDetailToggles,
  resolveSessionSidebarVisibility,
  shouldShowWorkstationPane,
  shouldAutoOpenSidebar,
  shouldShowSidebarSection,
  shouldShowInterventionQueue,
} from "./session-display"

describe("session-display", () => {
  test("cycles display modes in operator -> inspect -> quiet order", () => {
    expect(nextDisplayMode("operator")).toBe("inspect")
    expect(nextDisplayMode("inspect")).toBe("quiet")
    expect(nextDisplayMode("quiet")).toBe("operator")
  })

  test("quiet mode hides the session sidebar", () => {
    expect(
      resolveSessionSidebarVisibility({
        hasParentSession: false,
        sidebarOpen: true,
        displayMode: "quiet",
      }),
    ).toBe(false)
  })

  test("inspect mode can auto-open the session sidebar", () => {
    expect(shouldAutoOpenSidebar("inspect")).toBe(true)
    expect(shouldAutoOpenSidebar("operator")).toBe(false)
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

  test("operator mode keeps runtime sections while inspect keeps all", () => {
    expect(
      shouldShowSidebarSection({
        displayMode: "operator",
        section: "runtime",
      }),
    ).toBe(true)

    expect(
      shouldShowSidebarSection({
        displayMode: "operator",
        section: "reflection",
      }),
    ).toBe(false)

    expect(
      shouldShowSidebarSection({
        displayMode: "inspect",
        section: "reflection",
      }),
    ).toBe(true)
  })

  test("quiet mode hides workstation pane unless critical intervention is present", () => {
    expect(
      shouldShowWorkstationPane({
        displayMode: "quiet",
        paneVisibility: "auto",
        hasCriticalIntervention: false,
        isRuntimeCritical: true,
      }),
    ).toBe(false)

    expect(
      shouldShowWorkstationPane({
        displayMode: "quiet",
        paneVisibility: "auto",
        hasCriticalIntervention: true,
        isRuntimeCritical: false,
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
