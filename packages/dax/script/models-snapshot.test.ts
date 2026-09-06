import { expect, test } from "bun:test"
import { modelsSnapshotSource } from "./models-snapshot"

test("snapshot generation rejects executable responses and invalid provider schemas", () => {
  for (const data of ["{}; process.exit(99); //", "null", "[]", '{"test":{"name":"missing fields"}}']) {
    expect(() => modelsSnapshotSource(data)).toThrow()
  }
  expect(() => modelsSnapshotSource(JSON.stringify({
    test: { id: "test", name: "Test", env: [], models: { broken: { id: "broken" } } },
  }))).toThrow()
})

test("snapshot generation preserves code-like strings as inert model data", async () => {
  const snapshot = {
    test: { id: "test", name: '"}; throw new Error("injected"); //', env: [], models: {} },
  }
  const source = modelsSnapshotSource(JSON.stringify(snapshot))
  const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(source)
  const imported = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`)
  expect(imported.snapshot).toEqual(snapshot)
})

test("snapshot generation accepts models.dev fields that are optional by contract", () => {
  const snapshot = {
    test: {
      id: "test",
      name: "Test",
      env: [],
      models: {
        audio: {
          id: "audio",
          name: "Audio",
          release_date: "2026-01-01",
          attachment: false,
          reasoning: false,
          tool_call: false,
          limit: { context: 8192, output: 8192 },
        },
      },
    },
  }

  expect(() => modelsSnapshotSource(JSON.stringify(snapshot))).not.toThrow()
})
