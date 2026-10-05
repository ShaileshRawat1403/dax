import { spyOn } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { ProjectRoutes } from "@/server/routes/project"
import { readApprovedProjectMemory } from "@/pm/approved-memory"
import { readProjectEvents } from "@/state/events/project-journal"

/** Actual operator HTTP producer and fresh SessionPrompt consumer; only provider I/O is stopped. */
export async function observeProjectMemory(home: string) {
  await mkdir(path.join(home, ".config", "dax"), { recursive: true })
  return Instance.provide({ directory: path.resolve(import.meta.dir, "../../../.."), async fn() {
    const owner = await Session.create({ title: "Operator project memory review" })
    await SessionPrompt.ensureCanonicalRunBirth({ sessionID: owner.id, intent: "Review project memory" })
    const app = ProjectRoutes()
    const post = async (route: string, body: unknown) => app.request(`http://dax.internal${route}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    })
    const factId = `fact_${crypto.randomUUID().replaceAll("-", "")}`
    const content = `Prefer tests (${factId}).`
    const candidateId = `pfc_${crypto.randomUUID().replaceAll("-", "")}`
    const proposed = await post("/facts/candidates", { runId: owner.id, candidateId, change: {
      type: "project_fact_promoted", payload: { fact: {
        factId, kind: "memory", category: "preference", title: "Verification preference", content, tags: [],
      } },
    } })
    if (proposed.status !== 200) throw new Error(`Memory proposal HTTP ${proposed.status}`)
    const candidate = await proposed.json() as { subject: { digest: string } }
    const before = await readProjectEvents()
    const unavailableBeforeDecision = !(await readApprovedProjectMemory({ project_id: Instance.project.id, limit: 20 }))
      .entries.some((entry) => entry.id === factId)
    const bad = await post(`/facts/candidates/${candidateId}/review`, {
      actor: "test-operator", decision: "approved", digest: `sha256:${"0".repeat(64)}`,
    })
    const unchangedOnMismatch = JSON.stringify(await readProjectEvents()) === JSON.stringify(before)
    const approved = await post(`/facts/candidates/${candidateId}/review`, {
      actor: "test-operator", decision: "approved", digest: candidate.subject.digest,
    })
    if (approved.status !== 200) throw new Error(`Memory review HTTP ${approved.status}`)
    const read = async () => {
      const fresh = await Session.create({ title: "Future memory consumer" })
      let failure: unknown
      await SessionPrompt.prompt({ sessionID: fresh.id,
        model: { providerID: "missing-memory-fixture", modelID: "fixture" },
        parts: [{ type: "text", text: "Inspect this repository" }] }).catch((error) => { failure = error })
      if (!Provider.ModelNotFoundError.isInstance(failure)) throw new Error("Memory consumer did not reach the controlled provider boundary")
      return JSON.stringify((await Session.get(fresh.id)).state_v2?.intent)
    }
    const defaultModel = spyOn(Provider, "defaultModel").mockRejectedValue(new Error("no intent model in this fixture"))
    const stream = spyOn(LLM, "stream").mockRejectedValue(new Error("unexpected model stream"))
    try {
      const futureUsesApprovedFact = (await read())?.includes(content) === true
      const retiredId = `pfc_${crypto.randomUUID().replaceAll("-", "")}`
      const retirement = await post("/facts/candidates", { runId: owner.id, candidateId: retiredId, change: {
        type: "project_fact_retired", payload: { factId, reason: "Operator revoked this memory" },
      } })
      if (retirement.status !== 200) throw new Error(`Memory retirement proposal HTTP ${retirement.status}`)
      const retirementCandidate = await retirement.json() as { subject: { digest: string } }
      const revoked = await post(`/facts/candidates/${retiredId}/review`, {
        actor: "test-operator", decision: "approved", digest: retirementCandidate.subject.digest,
      })
      if (revoked.status !== 200) throw new Error(`Memory retirement review HTTP ${revoked.status}`)
      const futureExcludesRetiredFact = !(await read())?.includes(content)
      return { unavailableBeforeDecision, mismatchRejected: bad.status !== 200,
        unchangedOnMismatch, futureUsesApprovedFact, futureExcludesRetiredFact,
        providerStreams: stream.mock.calls.length }
    } finally { defaultModel.mockRestore(); stream.mockRestore() }
  } })
}
