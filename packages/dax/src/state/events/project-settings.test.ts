import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "@/project/instance"
import { PM } from "@/pm"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { ProjectRoutes } from "@/server/routes/project"
import { readProjectEvents } from "./project-journal"
import { clearRunEvents } from "./run-event-store"
import { ProjectSettingsSnapshotSchema } from "./project-settings"

let home: string
let directory: string
let previous: string | undefined
beforeEach(async () => {
  previous = process.env.DAX_TEST_HOME
  home = await mkdtemp(path.join(os.tmpdir(), "dax-settings-"))
  process.env.DAX_TEST_HOME = home
  directory = path.join(home, "project")
  await mkdir(directory)
  await mkdir(path.join(home, ".config", "dax"), { recursive: true })
  await Bun.$`git init ${directory}`.quiet()
  await Bun.$`git -C ${directory} -c user.name=Fixture -c user.email=fixture@example.invalid -c commit.gpgsign=false commit --allow-empty -m ${crypto.randomUUID()}`.quiet()
  const id = (await Bun.$`git -C ${directory} rev-parse HEAD`.quiet().text()).trim()
  await writeFile(path.join(directory, ".git", "dax"), id)
})
afterEach(async () => {
  await Instance.disposeAll()
  if (previous === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previous
  await rm(home, { recursive: true, force: true })
})

async function fixture(fn: (post: (route: string, body: unknown) => Promise<Response>, runId: string) => Promise<void>) {
  await Instance.provide({ directory, async fn() {
    const owner = await Session.create({ title: "Settings operator" })
    await SessionPrompt.ensureCanonicalRunBirth({ sessionID: owner.id, intent: "Review project settings" })
    const app = ProjectRoutes()
    await fn(async (route, body) => app.request(`http://dax.internal${route}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }), owner.id)
  } })
}

const snapshot = { riskMode: "conservative", preferences: [{ key: "style", value: "reviewed" }], constraints: [] }

test("operator adoption switches effective readers only after review and freezes legacy writers", async () => {
  await fixture(async (post, runId) => {
    const project_id = Instance.project.id
    await PM.set_preference({ project_id, pref_key: "style", pref_value: "legacy" })
    const input = await PM.settings_review_input({ project_id })
    expect(input.authority).toBe("legacy")
    const candidateId = `pfc_${crypto.randomUUID().replaceAll("-", "")}`
    const proposal = await post("/facts/candidates", { runId, candidateId, change: {
      type: "project_settings_adopted", payload: { snapshot, priorLegacyDigest: input.legacyDigest },
    } })
    expect(proposal.status).toBe(200)
    const candidate = await proposal.json() as { subject: { digest: string } }
    expect((await PM.list_preferences({ project_id }))[0].pref_value).toBe("legacy")
    const before = await readProjectEvents()
    expect((await post(`/facts/candidates/${candidateId}/review`, {
      actor: "operator", decision: "approved", digest: `sha256:${"0".repeat(64)}`,
    })).status).toBe(409)
    expect(await readProjectEvents()).toEqual(before)
    expect((await post(`/facts/candidates/${candidateId}/review`, {
      actor: "operator", decision: "approved", digest: candidate.subject.digest,
    })).status).toBe(200)
    expect((await PM.list_preferences({ project_id }))[0].pref_value).toBe("reviewed")
    expect((await PM.get_state({ project_id })).risk_mode).toBe("conservative")
    expect((await PM.legacy_settings_snapshot({ project_id })).snapshot.preferences[0].value).toBe("legacy")
    let failure: unknown
    try { await PM.set_preference({ project_id, pref_key: "style", pref_value: "bypass" }) } catch (error) { failure = error }
    expect((failure as Error).message).toBe("project_settings_review_required")
    const current = await PM.settings_review_input({ project_id })
    const nextId = `pfc_${crypto.randomUUID().replaceAll("-", "")}`
    const next = await post("/facts/candidates", { runId, candidateId: nextId, change: {
      type: "project_settings_replaced", payload: { snapshot: { ...snapshot, preferences: [] }, priorSettingsEventId: current.priorSettingsEventId },
    } })
    expect(next.status).toBe(200)
    const staleId = `pfc_${crypto.randomUUID().replaceAll("-", "")}`
    const stale = await post("/facts/candidates", { runId, candidateId: staleId, change: {
      type: "project_settings_replaced", payload: { snapshot, priorSettingsEventId: current.priorSettingsEventId },
    } })
    expect(stale.status).toBe(200)
    const staleCandidate = await stale.json() as { subject: { digest: string } }
    const nextCandidate = await next.json() as { subject: { digest: string } }
    expect((await post(`/facts/candidates/${nextId}/review`, {
      actor: "operator", decision: "approved", digest: nextCandidate.subject.digest,
    })).status).toBe(200)
    expect(await PM.list_preferences({ project_id })).toEqual([])
    const replaced = await readProjectEvents()
    expect((await post(`/facts/candidates/${staleId}/review`, {
      actor: "operator", decision: "approved", digest: staleCandidate.subject.digest,
    })).status).toBe(409)
    expect(await readProjectEvents()).toEqual(replaced)
    await clearRunEvents(runId)
    expect((await PM.settings_review_input({ project_id })).authority).toBe("journal")
    expect((await PM.get_state({ project_id })).risk_mode).toBe("conservative")
  })
})

test("changed legacy settings invalidate a pending adoption without publishing settings", async () => {
  await fixture(async (post, runId) => {
    const project_id = Instance.project.id
    const input = await PM.settings_review_input({ project_id })
    const candidateId = `pfc_${crypto.randomUUID().replaceAll("-", "")}`
    const proposal = await post("/facts/candidates", { runId, candidateId, change: {
      type: "project_settings_adopted", payload: { snapshot, priorLegacyDigest: input.legacyDigest },
    } })
    expect(proposal.status).toBe(200)
    const candidate = await proposal.json() as { subject: { digest: string } }
    await PM.set_preference({ project_id, pref_key: "newer", pref_value: "keep" })
    const before = await readProjectEvents()
    expect((await post(`/facts/candidates/${candidateId}/review`, {
      actor: "operator", decision: "approved", digest: candidate.subject.digest,
    })).status).toBe(409)
    expect(await readProjectEvents()).toEqual(before)
    expect((await PM.settings_review_input({ project_id })).authority).toBe("legacy")
  })
})

test("settings reject duplicate keys and unknown authority fields", () => {
  expect(ProjectSettingsSnapshotSchema.safeParse({ ...snapshot, preferences: [snapshot.preferences[0], snapshot.preferences[0]] }).success).toBe(false)
  expect(ProjectSettingsSnapshotSchema.safeParse({ ...snapshot, grants: ["*"] }).success).toBe(false)
})
