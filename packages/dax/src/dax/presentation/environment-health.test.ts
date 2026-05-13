import { describe, expect, test } from "bun:test"
import { deriveEnvironmentHealth, type EnvironmentHealthInput } from "./environment-health"
import { resolveUIState, type ActiveUIState } from "./ui-state-resolver"

function input(overrides: Partial<EnvironmentHealthInput> = {}): EnvironmentHealthInput {
  return {
    providers: [{}],
    mcp: {},
    lsp: [],
    ...overrides,
  }
}

describe("deriveEnvironmentHealth", () => {
  describe("provider", () => {
    test("configured provider is healthy", () => {
      const health = deriveEnvironmentHealth(input({ providers: [{ id: "anthropic" }] }))
      expect(health.provider).toBe("healthy")
    })

    test("multiple configured providers are healthy", () => {
      const health = deriveEnvironmentHealth(
        input({ providers: [{ id: "anthropic" }, { id: "openai" }] }),
      )
      expect(health.provider).toBe("healthy")
    })

    test("no providers configured is unavailable", () => {
      const health = deriveEnvironmentHealth(input({ providers: [] }))
      expect(health.provider).toBe("unavailable")
    })
  })

  describe("mcp", () => {
    test("empty mcp record is healthy (optional service)", () => {
      const health = deriveEnvironmentHealth(input({ mcp: {} }))
      expect(health.mcp).toBe("healthy")
    })

    test("all connected is healthy", () => {
      const health = deriveEnvironmentHealth(
        input({ mcp: { a: { status: "connected" }, b: { status: "connected" } } }),
      )
      expect(health.mcp).toBe("healthy")
    })

    test("disabled servers are healthy (intentional off)", () => {
      const health = deriveEnvironmentHealth(
        input({ mcp: { a: { status: "connected" }, b: { status: "disabled" } } }),
      )
      expect(health.mcp).toBe("healthy")
    })

    test("failed server alone is degraded", () => {
      const health = deriveEnvironmentHealth(
        input({ mcp: { a: { status: "failed", error: "boom" } } }),
      )
      expect(health.mcp).toBe("degraded")
    })

    test("needs_auth is unavailable", () => {
      const health = deriveEnvironmentHealth(input({ mcp: { a: { status: "needs_auth" } } }))
      expect(health.mcp).toBe("unavailable")
    })

    test("needs_client_registration is unavailable", () => {
      const health = deriveEnvironmentHealth(
        input({ mcp: { a: { status: "needs_client_registration", error: "missing" } } }),
      )
      expect(health.mcp).toBe("unavailable")
    })

    test("needs_auth wins over failed (unavailable beats degraded)", () => {
      const health = deriveEnvironmentHealth(
        input({
          mcp: {
            a: { status: "failed", error: "x" },
            b: { status: "needs_auth" },
          },
        }),
      )
      expect(health.mcp).toBe("unavailable")
    })

    test("connected with one failed is degraded", () => {
      const health = deriveEnvironmentHealth(
        input({
          mcp: {
            a: { status: "connected" },
            b: { status: "failed", error: "x" },
          },
        }),
      )
      expect(health.mcp).toBe("degraded")
    })
  })

  describe("lsp", () => {
    test("empty lsp list is healthy", () => {
      const health = deriveEnvironmentHealth(input({ lsp: [] }))
      expect(health.lsp).toBe("healthy")
    })

    test("all connected is healthy", () => {
      const health = deriveEnvironmentHealth(
        input({ lsp: [{ status: "connected" }, { status: "connected" }] }),
      )
      expect(health.lsp).toBe("healthy")
    })

    test("any error is degraded", () => {
      const health = deriveEnvironmentHealth(
        input({ lsp: [{ status: "connected" }, { status: "error" }] }),
      )
      expect(health.lsp).toBe("degraded")
    })
  })

  describe("composition", () => {
    test("idle/empty workstation: provider unavailable wins footer", () => {
      const health = deriveEnvironmentHealth({ providers: [], mcp: {}, lsp: [] })
      expect(health).toEqual({ provider: "unavailable", mcp: "healthy", lsp: "healthy" })
    })

    test("all configured and healthy", () => {
      const health = deriveEnvironmentHealth({
        providers: [{ id: "anthropic" }],
        mcp: { a: { status: "connected" } },
        lsp: [{ status: "connected" }],
      })
      expect(health).toEqual({ provider: "healthy", mcp: "healthy", lsp: "healthy" })
    })

    test("mcp needs_auth and lsp error: footer surfaces mcp unavailable", () => {
      const health = deriveEnvironmentHealth({
        providers: [{ id: "anthropic" }],
        mcp: { a: { status: "needs_auth" } },
        lsp: [{ status: "error" }],
      })
      expect(health).toEqual({ provider: "healthy", mcp: "unavailable", lsp: "degraded" })

      const active: ActiveUIState = {
        run: "ready",
        user: null,
        environment: health,
        safety: [],
        focus: "none",
      }
      const projection = resolveUIState(active, 0, null)
      expect(projection.footer.health).toBe("unavailable")
      expect(projection.footer.reason).toBe("mcp unavailable")
    })

    test("downstream: clean environment produces healthy footer projection", () => {
      const health = deriveEnvironmentHealth({
        providers: [{ id: "anthropic" }],
        mcp: { a: { status: "connected" } },
        lsp: [{ status: "connected" }],
      })
      const projection = resolveUIState(
        {
          run: "ready",
          user: null,
          environment: health,
          safety: [],
          focus: "none",
        },
        0,
        null,
      )
      expect(projection.footer.health).toBe("healthy")
      expect(projection.footer.label).toBe("● Env")
      expect(projection.footer.reason).toBeUndefined()
    })
  })

  describe("determinism", () => {
    test("same input produces equal output", () => {
      const inp = input({
        providers: [{ id: "a" }],
        mcp: { x: { status: "failed", error: "y" } },
        lsp: [{ status: "error" }],
      })
      const a = deriveEnvironmentHealth(inp)
      const b = deriveEnvironmentHealth(inp)
      expect(a).toEqual(b)
    })
  })
})
