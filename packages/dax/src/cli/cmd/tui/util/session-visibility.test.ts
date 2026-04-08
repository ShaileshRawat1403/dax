import { describe, expect, test } from "bun:test"
import { isPlaceholderSessionShell, visibleSessionList } from "./session-visibility"

describe("session visibility", () => {
  test("hides fresh placeholder shells from curated session surfaces", () => {
    const session = {
      id: "ses_123",
      slug: "shell",
      projectID: "project_1",
      directory: "/tmp/repo",
      title: "External run",
      version: "local",
      time: {
        created: 1000,
        updated: 1400,
      },
      state_v2: {},
    }

    expect(isPlaceholderSessionShell(session as any)).toBe(true)
    expect(visibleSessionList([session as any])).toHaveLength(0)
  })

  test("keeps real sessions visible when they have a concrete title or substantial age", () => {
    const titled = {
      id: "ses_234",
      slug: "real",
      projectID: "project_1",
      directory: "/tmp/repo",
      title: "Release readiness pass",
      version: "local",
      time: {
        created: 1000,
        updated: 1200,
      },
    }

    const historical = {
      id: "ses_345",
      slug: "historic",
      projectID: "project_1",
      directory: "/tmp/repo",
      title: "External run",
      version: "local",
      time: {
        created: 1000,
        updated: 200000,
      },
    }

    expect(isPlaceholderSessionShell(titled as any)).toBe(false)
    expect(isPlaceholderSessionShell(historical as any)).toBe(false)
    expect(visibleSessionList([titled as any, historical as any])).toHaveLength(2)
  })
})
