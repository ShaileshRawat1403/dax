// Opt-in live UAT of the normal session prompt route, without a worker wizard.
import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), "dax-agy-chat-")))
process.env.DAX_TEST_HOME = scratch
const { Instance } = await import("../src/project/instance")
const { Session } = await import("../src/session")
const { SessionPrompt } = await import("../src/session/prompt")
const { SessionRoutes } = await import("../src/server/routes/session")
const { ShareNext } = await import("../src/share/share-next")
const { Identifier } = await import("../src/id/id")
const { AntigravityConversation } = await import("../src/worker/antigravity-conversation")
const { discoverAntigravityModels } = await import("../src/worker/antigravity-models")
const { redactEvidenceText } = await import("../src/worker/evidence-redaction")
const { getProjectedRunState } = await import("../src/state/events/run-event-store")

async function send(input: Parameters<typeof SessionPrompt.prompt>[0]) {
  const { sessionID, ...body } = input
  const response = await SessionRoutes().request(`/${sessionID}/message`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  })
  const value = await response.json()
  if (!response.ok) throw new Error(`Chat HTTP ${response.status}: ${value.data?.message ?? JSON.stringify(value)}`)
  return value as Awaited<ReturnType<typeof SessionPrompt.prompt>>
}

try {
  await Instance.provide({
    directory: new URL("../../..", import.meta.url).pathname,
    fn: async () => {
      await ShareNext.init()
      const models = await discoverAntigravityModels({ forceRefresh: true })
      const selected = process.env.DAX_AGY_UAT_MODEL ? models.find((model) => model.id === process.env.DAX_AGY_UAT_MODEL) : models[0]
      if (!selected) throw new Error("Requested UAT model is not available through agy models")
      const session = await Session.create({ title: "AGY normal chat UAT" })
      const model = { providerID: "worker:antigravity", modelID: selected.id }
      const messageID = Identifier.ascending("message")
      try {
        const first = await send({
          sessionID: session.id,
          messageID,
          model,
          parts: [{ type: "text", text: "Hi. Reply with exactly HELLO. Do not use tools or change files." }],
        })
        if (!first.parts.some((part) => part.type === "text" && part.text.trim() === "HELLO"))
          throw new Error("First chat reply failed")
        if (first.info.role !== "assistant" || first.info.parentID !== messageID)
          throw new Error("Chat message identity changed")
        const conversationID = (await Session.get(session.id)).externalAgent?.conversationID
        const second = await send({
          sessionID: session.id,
          model,
          parts: [
            {
              type: "text",
              text: "What word did I ask for? Reply with only that word. Do not use tools or change files.",
            },
          ],
        })
        if (!second.parts.some((part) => part.type === "text" && part.text.trim() === "HELLO"))
          throw new Error("Follow-up chat context failed")
        if (!conversationID || (await Session.get(session.id)).externalAgent?.conversationID !== conversationID)
          throw new Error("AGY conversation changed")
        console.log(
          `PASS: ${selected.id}: session HTTP endpoint returned HELLO twice, preserved message ID and conversation context, with sharing listener enabled.`,
        )
      } finally {
        await AntigravityConversation.cancelSession(session.id)
        // Let the owning workflow record cancellation and remove its checkout
        // before deleting the test's storage directory.
        for (let attempt = 0; attempt < 100; attempt++) {
          if ((await getProjectedRunState(session.id))?.status === "failed") break
          await Bun.sleep(50)
        }
      }
    },
  })
} catch (error) {
  console.error(redactEvidenceText(String(error)))
  process.exitCode = 1
} finally {
  await Instance.disposeAll()
  await rm(scratch, { recursive: true, force: true })
}
