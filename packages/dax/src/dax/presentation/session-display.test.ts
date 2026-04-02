import { describe, expect, test } from "bun:test"
import {
  nextDisplayMode,
  resolveSessionSidebarVisibility,
  shouldAutoOpenSidebar,
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
})
