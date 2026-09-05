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
