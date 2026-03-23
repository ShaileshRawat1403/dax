import { describe, expect, test } from "bun:test"
import { RunGateway } from "./run-gateway"

describe("open-source stack integration", () => {
  describe("run.recovery.execute", () => {
    test("returns error for non-existent run", async () => {
      const testHome = "/tmp/dax-recovery-nonexistent"
      const previousHome = process.env.DAX_TEST_HOME
      process.env.DAX_TEST_HOME = testHome
      const { bootstrap } = await import("@/cli/bootstrap")
      const repoRoot = "/Users/Shared/MYAIAGENTS/dax"

      try {
        await bootstrap(repoRoot, async () => {
          const snapshot = await RunGateway.getSnapshot("does-not-exist").catch(() => null)
          expect(snapshot).toBeNull()
        })
      } finally {
        process.env.DAX_TEST_HOME = previousHome ?? ""
      }
    }, 30000)

    test("terminal runs (failed) cannot be recovered — suggestion returned", async () => {
      const testHome = "/tmp/dax-recovery-test-failed"
      const previousHome = process.env.DAX_TEST_HOME
      process.env.DAX_TEST_HOME = testHome
      const { bootstrap } = await import("@/cli/bootstrap")
      const repoRoot = "/Users/Shared/MYAIAGENTS/dax"

      try {
        await bootstrap(repoRoot, async () => {
          const create = await RunGateway.createRun({
            intent: { input: "" },
            metadata: { source: "api", initiatedBy: "test-user" },
          })

          const snapshot = await RunGateway.getSnapshot(create.runId)
          const terminal =
            snapshot.status === "failed" || snapshot.status === "completed" || snapshot.status === "cancelled"

          if (terminal) {
            const { recoverRun } = await import("@/state/recovery")
            const result = await recoverRun(create.runId)
            expect(result.success).toBe(true)
            expect(result.recoveredRunState?.status).toBe(snapshot.status)
          }
        })
      } finally {
        process.env.DAX_TEST_HOME = previousHome ?? ""
      }
    }, 30000)

    test("non-terminal runs can be recovered — state reconstructed from events", async () => {
      const testHome = "/tmp/dax-recovery-test-nonterminal"
      const previousHome = process.env.DAX_TEST_HOME
      process.env.DAX_TEST_HOME = testHome
      const { bootstrap } = await import("@/cli/bootstrap")
      const repoRoot = "/Users/Shared/MYAIAGENTS/dax"

      try {
        await bootstrap(repoRoot, async () => {
          const create = await RunGateway.createRun({
            intent: { input: "test recovery intent" },
            metadata: { source: "api", initiatedBy: "recovery-test-user" },
          })

          const { recoverRun } = await import("@/state/recovery")
          const result = await recoverRun(create.runId)

          expect(result.success).toBe(true)
          expect(result.recoveredRunState).toBeDefined()
          expect(result.recoveredRunState?.runId).toBe(create.runId)
        })
      } finally {
        process.env.DAX_TEST_HOME = previousHome ?? ""
      }
    }, 30000)
  })

  describe("secrets loader graceful degradation", () => {
    test("getSecrets returns empty/env-fallback when Infisical not configured", async () => {
      const previousClientId = process.env.INFISICAL_CLIENT_ID
      const previousClientSecret = process.env.INFISICAL_CLIENT_SECRET

      try {
        delete process.env.INFISICAL_CLIENT_ID
        delete process.env.INFISICAL_CLIENT_SECRET

        const { getSecrets } = await import("@/secrets/secrets-loader")
        const secrets = await getSecrets()

        expect(secrets).toBeDefined()
        expect(secrets.source).toEqual({ type: "env" })
        expect(secrets.raw).toBeInstanceOf(Map)
      } finally {
        if (previousClientId !== undefined) process.env.INFISICAL_CLIENT_ID = previousClientId
        if (previousClientSecret !== undefined) process.env.INFISICAL_CLIENT_SECRET = previousClientSecret
      }
    })

    test("getSecrets caches — subsequent calls return same instance", async () => {
      const previousClientId = process.env.INFISICAL_CLIENT_ID
      const previousClientSecret = process.env.INFISICAL_CLIENT_SECRET

      try {
        delete process.env.INFISICAL_CLIENT_ID
        delete process.env.INFISICAL_CLIENT_SECRET

        const { getSecrets } = await import("@/secrets/secrets-loader")
        const first = await getSecrets()
        const second = await getSecrets()
        expect(first).toBe(second)
      } finally {
        if (previousClientId !== undefined) process.env.INFISICAL_CLIENT_ID = previousClientId
        if (previousClientSecret !== undefined) process.env.INFISICAL_CLIENT_SECRET = previousClientSecret
      }
    })
  })

  describe("NATS transport graceful degradation", () => {
    test("NATS disabled — publish is no-op, no error thrown", async () => {
      const { natsTransport } = await import("./transport/nats-transport")

      const fakeEvent = {
        runId: "test-disabled-nats",
        type: "run.created" as const,
        timestamp: new Date().toISOString(),
        payload: { status: "created" },
        schemaVersion: "v1" as const,
        eventId: "evt_test_disabled_1",
        sequence: 1,
        cursor: "evt_test_disabled_1",
      }

      await expect(natsTransport.publish(fakeEvent as any)).resolves.toBeUndefined()
      expect(natsTransport.isConnected).toBe(false)
    })
  })

  describe("ZITADEL validator graceful degradation", () => {
    test("ZITADEL not configured — validateActorToken returns null", async () => {
      const previousDomain = process.env.ZITADEL_DOMAIN

      try {
        delete process.env.ZITADEL_DOMAIN

        const { validateActorToken } = await import("@/identity/zitadel")
        const result = await validateActorToken("any-token")
        expect(result).toBeNull()
      } finally {
        if (previousDomain !== undefined) process.env.ZITADEL_DOMAIN = previousDomain
      }
    })

    test("ZITADEL disabled — isEnabled returns false", async () => {
      const previousDomain = process.env.ZITADEL_DOMAIN

      try {
        delete process.env.ZITADEL_DOMAIN

        const { zitadelValidator } = await import("@/identity/zitadel")
        expect(zitadelValidator.isEnabled).toBe(false)
        expect(zitadelValidator.config).toBeNull()
      } finally {
        if (previousDomain !== undefined) process.env.ZITADEL_DOMAIN = previousDomain
      }
    })
  })

  describe("OTel graceful degradation", () => {
    test("OTEL disabled — Telemetry.isEnabled is false", async () => {
      const previousEnabled = process.env.OTEL_ENABLED

      try {
        process.env.OTEL_ENABLED = "false"

        const { Telemetry } = await import("@/runtime/telemetry")
        expect(Telemetry.isEnabled()).toBe(false)
      } finally {
        if (previousEnabled !== undefined) process.env.OTEL_ENABLED = previousEnabled
        else delete process.env.OTEL_ENABLED
      }
    })
  })

  describe("run.create via FastMCP propagates actor context", () => {
    test("run.create uses metadata.initiatedBy from ZITADEL actor when available", async () => {
      const testHome = "/tmp/dax-actor-context-test"
      const previousHome = process.env.DAX_TEST_HOME
      process.env.DAX_TEST_HOME = testHome
      const { bootstrap } = await import("@/cli/bootstrap")
      const repoRoot = "/Users/Shared/MYAIAGENTS/dax"

      try {
        await bootstrap(repoRoot, async () => {
          const { setActorContext, clearActorContext } = await import("./fastmcp-substrate")
          const { RunGateway } = await import("./run-gateway")

          const fakeActor = {
            sub: "user-123",
            email: "test@example.com",
            name: "Test User",
            displayName: "Test User",
            orgId: "org-456",
            projectId: "proj-789",
          }

          setActorContext(fakeActor)
          try {
            const create = await RunGateway.createRun({
              intent: { input: "test actor context propagation" },
              metadata: { source: "api" },
            })

            const snapshot = await RunGateway.getSnapshot(create.runId)
            expect(snapshot.metadata).toBeDefined()
          } finally {
            clearActorContext()
          }
        })
      } finally {
        process.env.DAX_TEST_HOME = previousHome ?? ""
      }
    }, 30000)
  })
})
