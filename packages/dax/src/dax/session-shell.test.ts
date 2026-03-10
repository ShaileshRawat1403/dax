import { describe, expect, test } from "bun:test"
import { SESSION_COMMAND_BINDINGS, SESSION_COMMAND_LABELS, SESSION_SHELL_ROLES } from "./session-shell"
import { Config } from "@/config/config"

describe("session shell contract", () => {
  test("uses stable user-intent labels for core review and navigation actions", () => {
    expect(SESSION_COMMAND_LABELS.reviewApprovals).toBe("Open approvals")
    expect(SESSION_COMMAND_LABELS.reviewDiff).toBe("Inspect evidence")
    expect(SESSION_COMMAND_LABELS.inspectMcp).toBe("Inspect MCP")
    expect(SESSION_COMMAND_LABELS.reviewDocs).toBe("Open audit")
    expect(SESSION_COMMAND_LABELS.jumpTimeline).toBe("Jump to transcript")
    expect(SESSION_COMMAND_LABELS.jumpLastRequest).toBe("Jump to request")
    expect(SESSION_COMMAND_LABELS.jumpLive).toBe("Jump live")
  })

  test("defines one role per visible shell surface", () => {
    expect(SESSION_SHELL_ROLES.actionStrip).toBe("Alerts")
    expect(SESSION_SHELL_ROLES.navigator).toBe("Move through this session")
    expect(SESSION_SHELL_ROLES.reviewBar).toBe("Operator controls")
    expect(SESSION_SHELL_ROLES.sidebar).toBe("Operator overview")
  })

  test("registers dedicated review keybinds in config", () => {
    const keybinds = Config.Keybinds.parse({})
    expect(keybinds[SESSION_COMMAND_BINDINGS.reviewApprovals]).toBe("<leader>p")
    expect(keybinds[SESSION_COMMAND_BINDINGS.reviewDiff]).toBe("<leader>d")
    expect(keybinds[SESSION_COMMAND_BINDINGS.inspectMcp]).toBe("<leader>k")
  })
})
