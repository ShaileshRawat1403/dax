import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { rmSync } from "fs"

async function waitForPending(Permission: { list: () => Promise<any[]> }, count: number): Promise<any[]> {
  for (let attempt = 0; attempt < 1500; attempt++) {
    const pending = await Permission.list()
    if (pending.length === count) return pending
    await Bun.sleep(20)
  }
  return Permission.list()
}

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

          const pending = await waitForPending(Permission, 1)
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

          const secondPending = await waitForPending(Permission, 1)
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

          const pending = await waitForPending(Permission, 2)
          expect(pending.length).toBe(2)
          const firstRequest = pending.find((request) => request.patterns.includes(firstCommand))
          expect(firstRequest).toBeDefined()

          await Permission.reply({
            requestID: firstRequest!.id,
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

  test(
    "rust policy flag upgrades sensitive path allow rules to approval requests",
    async () => {
      const testHome = path.join(os.tmpdir(), `dax-test-home-${Date.now().toString(36)}-rust-policy`)
      const previousHome = process.env.DAX_TEST_HOME
      const previousRustPolicy = process.env.DAX_RUST_POLICY
      process.env.DAX_TEST_HOME = testHome
      process.env.DAX_RUST_POLICY = "1"

      try {
        const { bootstrap } = await import("@/cli/bootstrap")
        const { Permission } = await import("./next")
        const { Storage } = await import("@/storage/storage")
        const { Instance } = await import("@/project/instance")
        const repoRoot = path.resolve(import.meta.dir, "../../../..")

        // Stubbed so this asserts the clamping rule rather than whether a Rust
        // toolchain happens to be installed. policy.parity.test.ts covers the
        // real sidecar.
        Permission.PolicyEffects.set({
          classifyPaths: async () => [
            { path: "/project/.env.production", zone: "sensitive", reason: "production secrets" },
          ],
        })

        await bootstrap(repoRoot, async () => {
          await Storage.remove(["permission", Instance.project.id])

          const approval = Permission.ask({
            sessionID: "session_rust_policy",
            permission: "read",
            patterns: ["/project/.env.production"],
            always: ["/project/.env.production"],
            metadata: {},
            ruleset: Permission.fromConfig({
              read: "allow",
            } as any),
          })

          const pending = await waitForPending(Permission, 1)
          expect(pending.length).toBe(1)
          expect(pending[0]?.metadata.description).toContain("sensitive path")

          await Permission.reply({
            requestID: pending[0]!.id,
            reply: "once",
          })

          await approval
        })
      } finally {
        const { Permission: P } = await import("./next")
        P.PolicyEffects.reset()
        if (previousHome === undefined) delete process.env.DAX_TEST_HOME
        else process.env.DAX_TEST_HOME = previousHome
        if (previousRustPolicy === undefined) delete process.env.DAX_RUST_POLICY
        else process.env.DAX_RUST_POLICY = previousRustPolicy
        rmSync(testHome, { recursive: true, force: true })
      }
    },
    120000,
  )

  test(
    "rust policy flag keeps env example templates on the normal ruleset path",
    async () => {
      const testHome = path.join(os.tmpdir(), `dax-test-home-${Date.now().toString(36)}-rust-policy-env-example`)
      const previousHome = process.env.DAX_TEST_HOME
      const previousRustPolicy = process.env.DAX_RUST_POLICY
      process.env.DAX_TEST_HOME = testHome
      process.env.DAX_RUST_POLICY = "1"

      try {
        const { bootstrap } = await import("@/cli/bootstrap")
        const { Permission } = await import("./next")
        const { Storage } = await import("@/storage/storage")
        const { Instance } = await import("@/project/instance")
        const repoRoot = path.resolve(import.meta.dir, "../../../..")

        // A safe-zone classification must not escalate anything.
        Permission.PolicyEffects.set({
          classifyPaths: async () => [{ path: "/project/.env.example", zone: "repo_safe" }],
        })

        await bootstrap(repoRoot, async () => {
          await Storage.remove(["permission", Instance.project.id])

          await expect(
            Permission.ask({
              sessionID: "session_rust_policy_env_example",
              permission: "read",
              patterns: ["/project/.env.example"],
              always: ["/project/.env.example"],
              metadata: {},
              ruleset: Permission.fromConfig({
                read: "allow",
              } as any),
            }),
          ).resolves.toBeUndefined()

          expect(await Permission.list()).toHaveLength(0)
        })
      } finally {
        const { Permission: P } = await import("./next")
        P.PolicyEffects.reset()
        if (previousHome === undefined) delete process.env.DAX_TEST_HOME
        else process.env.DAX_TEST_HOME = previousHome
        if (previousRustPolicy === undefined) delete process.env.DAX_RUST_POLICY
        else process.env.DAX_RUST_POLICY = previousRustPolicy
        rmSync(testHome, { recursive: true, force: true })
      }
    },
    120000,
  )
  test(
    "fails closed when rust policy is requested but the engine cannot run",
    async () => {
      // Regression: this path returned an empty classification map behind a
      // log.warn, which reads downstream as "nothing is forbidden and nothing
      // is sensitive". Forbidden paths stopped being denied and sensitive paths
      // stopped being escalated from allow to ask, so an operator who opted
      // into stricter classification silently got the weaker ruleset.
      const testHome = path.join(os.tmpdir(), `dax-test-home-${Date.now().toString(36)}-rust-policy-closed`)
      const previousHome = process.env.DAX_TEST_HOME
      const previousRustPolicy = process.env.DAX_RUST_POLICY
      process.env.DAX_TEST_HOME = testHome
      process.env.DAX_RUST_POLICY = "1"

      try {
        const { bootstrap } = await import("@/cli/bootstrap")
        const { Permission } = await import("./next")
        const { Storage } = await import("@/storage/storage")
        const { Instance } = await import("@/project/instance")
        const repoRoot = path.resolve(import.meta.dir, "../../../..")

        Permission.PolicyEffects.set({
          classifyPaths: async () => {
            throw new Error("Executable not found in $PATH: \"cargo\"")
          },
        })

        await bootstrap(repoRoot, async () => {
          await Storage.remove(["permission", Instance.project.id])

          const attempt = Permission.ask({
            sessionID: "session_rust_policy_closed",
            permission: "read",
            patterns: ["/project/.env.production"],
            always: [],
            metadata: {},
            ruleset: Permission.fromConfig({ read: "allow" }),
          })

          await expect(attempt).rejects.toBeInstanceOf(Permission.PolicyUnavailableError)
        })

        // The message is the operator's remedy: the two ways out are opposites
        // and DAX must not choose one for them.
        const error = new Permission.PolicyUnavailableError(new Error("cargo missing"))
        expect(error.message).toContain("DAX_RUST_BIN_DIR")
        expect(error.message).toContain("unset DAX_RUST_POLICY")
      } finally {
        const { Permission } = await import("./next")
        Permission.PolicyEffects.reset()
        if (previousHome === undefined) delete process.env.DAX_TEST_HOME
        else process.env.DAX_TEST_HOME = previousHome
        if (previousRustPolicy === undefined) delete process.env.DAX_RUST_POLICY
        else process.env.DAX_RUST_POLICY = previousRustPolicy
        rmSync(testHome, { recursive: true, force: true })
      }
    },
    40000,
  )

})
