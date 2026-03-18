import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { rmSync } from "fs"

describe("permission approvals", () => {
  test(
    "supports one-time and persisted approvals with replay",
    async () => {
      const testHome = path.join(os.tmpdir(), `dax-test-home-${Date.now().toString(36)}`)
      const previousHome = process.env.DAX_TEST_HOME
      process.env.DAX_TEST_HOME = testHome

      try {
        const { bootstrap } = await import("@/cli/bootstrap")
        const { Permission } = await import("./next")
        const { Storage } = await import("@/storage/storage")
        const { Instance } = await import("@/project/instance")
        const repoRoot = path.resolve(import.meta.dir, "../../../..")
        const testCommand = `npm test --runInBand ${Date.now().toString(36)}`
        const buildCommand = `npm run build --profile ${Date.now().toString(36)}`

        await bootstrap(repoRoot, async () => {
          await Storage.remove(["permission", Instance.project.id])

          const once = Permission.ask({
            sessionID: "session_once",
            permission: "shell",
            patterns: [testCommand],
            always: [testCommand],
            metadata: {},
            ruleset: Permission.fromConfig({
              shell: "ask",
            } as any),
          })

          const pending = await Permission.list()
          expect(pending.length).toBe(1)
          expect(pending[0]?.permission).toBe("shell")

          await Permission.reply({
            requestID: pending[0]!.id,
            reply: "once",
          })

          await once

          const persisted = Permission.ask({
            sessionID: "session_always",
            permission: "shell",
            patterns: [buildCommand],
            always: [buildCommand],
            metadata: {},
            ruleset: Permission.fromConfig({
              shell: "ask",
            } as any),
          })

          const secondPending = await Permission.list()
          expect(secondPending.length).toBe(1)

          await Permission.reply({
            requestID: secondPending[0]!.id,
            reply: "always",
          })

          await persisted

          await expect(
            Permission.ask({
              sessionID: "session_replay",
              permission: "shell",
              patterns: [buildCommand],
              always: [buildCommand],
              metadata: {},
              ruleset: Permission.fromConfig({
                shell: "ask",
              } as any),
            }),
          ).resolves.toBeUndefined()
        })
      } finally {
        if (previousHome === undefined) delete process.env.DAX_TEST_HOME
        else process.env.DAX_TEST_HOME = previousHome
        rmSync(testHome, { recursive: true, force: true })
      }
    },
    40000,
  )

  test(
    "rejection with feedback surfaces corrected error and clears sibling requests",
    async () => {
      const testHome = path.join(os.tmpdir(), `dax-test-home-${Date.now().toString(36)}-reject`)
      const previousHome = process.env.DAX_TEST_HOME
      process.env.DAX_TEST_HOME = testHome

      try {
        const { bootstrap } = await import("@/cli/bootstrap")
        const { Permission } = await import("./next")
        const { Storage } = await import("@/storage/storage")
        const { Instance } = await import("@/project/instance")
        const repoRoot = path.resolve(import.meta.dir, "../../../..")
        const firstCommand = `rm -rf tmp-${Date.now().toString(36)}`
        const secondCommand = `git clean -fd tmp-${Date.now().toString(36)}`

        await bootstrap(repoRoot, async () => {
          await Storage.remove(["permission", Instance.project.id])

          const first = Permission.ask({
            sessionID: "session_reject",
            permission: "shell",
            patterns: [firstCommand],
            always: [firstCommand],
            metadata: {},
            ruleset: Permission.fromConfig({ shell: "ask" } as any),
          })
          const second = Permission.ask({
            sessionID: "session_reject",
            permission: "shell",
            patterns: [secondCommand],
            always: [secondCommand],
            metadata: {},
            ruleset: Permission.fromConfig({ shell: "ask" } as any),
          })

          const pending = await Permission.list()
          expect(pending.length).toBe(2)

          await Permission.reply({
            requestID: pending[0]!.id,
            reply: "reject",
            message: "Use a safer cleanup path.",
          })

          await expect(first).rejects.toThrow("Use a safer cleanup path.")
          await expect(second).rejects.toThrow("The user rejected permission")
          expect((await Permission.list()).length).toBe(0)
        })
      } finally {
        if (previousHome === undefined) delete process.env.DAX_TEST_HOME
        else process.env.DAX_TEST_HOME = previousHome
        rmSync(testHome, { recursive: true, force: true })
      }
    },
    40000,
  )
})
