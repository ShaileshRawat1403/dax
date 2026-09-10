import { test, expect, spyOn } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { Identifier } from "@/id/id"
import { Provider } from "@/provider/provider"
import { ShareNext } from "./share-next"
import { SessionRoutes } from "@/server/routes/session"

test("AGY chat survives the sharing listener and returns structured errors for a stopped session", async () => {
  const previous = process.env.DAX_TEST_HOME
  const home = await mkdtemp(path.join(os.tmpdir(), "dax-agy-listener-"))
  const directory = path.join(home, "project")
  await mkdir(directory)
  process.env.DAX_TEST_HOME = home
  const lookup = spyOn(Provider, "getModel").mockRejectedValue(new Error("External agents must not enter API model lookup"))
  try {
    await Instance.provide({ directory, fn: async () => {
      await ShareNext.init()
      const session = await Session.create({ title: "AGY listener regression" })
      const model = { providerID: "worker:antigravity", modelID: "gemini-3.8-flash-high" }
      const message = await Session.updateMessage({
        id: Identifier.ascending("message"), sessionID: session.id, role: "user",
        time: { created: Date.now() }, agent: "agy", model,
      })
      expect(message.role).toBe("user")
      expect(lookup).not.toHaveBeenCalled()
      await Session.update(session.id, (draft) => {
        draft.externalAgent = { kind: "antigravity", model: model.modelID, generationID: "test", phase: "failed" }
      })
      const response = await SessionRoutes().request(`/${session.id}/message`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, parts: [{ type: "text", text: "hello" }] }),
      })
      expect(response.status).toBe(409)
      const body = await response.json()
      expect(body.data.message).toContain("not live")
      expect(body).not.toHaveProperty("stack")
    } })
  } finally {
    lookup.mockRestore()
    await Instance.disposeAll()
    if (previous === undefined) delete process.env.DAX_TEST_HOME
    else process.env.DAX_TEST_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
})
