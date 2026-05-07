import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { detectDaxNativeChecks, detectGenericChecks } from "./check-catalog"

describe("SDLC check catalog", () => {
  test("detects only JavaScript scripts that actually exist", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "dax-sdlc-catalog-"))

    try {
      writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({
          scripts: {
            typecheck: "tsc --noEmit",
          },
        }),
      )

      const checks = detectGenericChecks(dir)

      expect(checks.map((check) => check.id)).toEqual(["js-typecheck"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("detects DAX-native verification scripts separately", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "dax-sdlc-native-"))

    try {
      writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({
          scripts: {
            "verify:hybrid": "bun run typecheck",
            "proof:check": "bun run rust:verify",
          },
        }),
      )

      const checks = detectDaxNativeChecks(dir)

      expect(checks.map((check) => check.id)).toEqual(["dax-verify-hybrid", "dax-proof-check"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
