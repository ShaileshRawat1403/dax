// Opt-in live UAT: bun script/test-agy-conversation.ts
// Uses only the official authenticated CLI in a temporary sandboxed project.
import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { discoverAntigravityModels } from "../src/worker/antigravity-models"
import { buildWorkerInvocation } from "../src/worker/worker-adapter"
import { buildWorkerSandboxPlan } from "../src/worker/worker-sandbox"
import { startEgressProxy } from "../src/worker/egress-proxy"
import { startAntigravityProcess } from "../src/worker/antigravity-process"
import { redactEvidenceText } from "../src/worker/evidence-redaction"

const cwd = await realpath(await mkdtemp(path.join(os.tmpdir(), "dax-agy-stream-")))
const model = (await discoverAntigravityModels({ forceRefresh: true }))[0].id
const invocation = buildWorkerInvocation({
  workerId: "antigravity",
  workingDirectory: cwd,
  hostEnv: process.env,
  contract: {
    runId: "agy-stream-uat",
    task: "Transport check",
    modelHint: model,
    writeScope: [],
    forbiddenPaths: [],
    verification: [],
  },
  timeoutMs: 120_000,
})
const proxy = await startEgressProxy({
  allowHosts: invocation.egress.mode === "filtered" ? invocation.egress.allowHosts : [],
})
const plan = buildWorkerSandboxPlan({
  cwd,
  network: "full",
  writableStatePaths: invocation.writableStatePaths,
  command: [
    "agy",
    "--new-project",
    "--add-dir",
    cwd,
    "--mode",
    "accept-edits",
    "--model",
    model,
    "--disable-slash-commands",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--print-timeout",
    "120s",
  ],
})
const worker = startAntigravityProcess({
  command: plan.command,
  cwd,
  model,
  timeoutMs: 120_000,
  env: { ...invocation.env, PATH: process.env.PATH ?? "", ...proxy.proxyEnv },
  onRecord: async (record) =>
    console.log(
      record.event === "step_update"
        ? `${record.event}: ${record.step_update.step_type}/${record.step_update.state}`
        : record.event,
    ),
})
try {
  const one = await worker.send("Reply with exactly READY. Do not use any tools.")
  const two = await worker.send(
    "What exact word did I ask you to reply with? Reply with just that word. Do not use any tools.",
  )
  if (one.conversation_id !== two.conversation_id || two.num_turns !== 2 || two.response.trim() !== "READY")
    throw new Error("Conversation continuity failed.")
  worker.finish()
  await worker.done
  console.log(`PASS: two official AGY turns, one conversation, ${plan.provider}, clean shutdown.`)
} catch (error) {
  console.error(redactEvidenceText(String(error)))
  process.exitCode = 1
} finally {
  worker.cancel()
  await worker.done.catch(() => {})
  await proxy.close()
  await rm(cwd, { recursive: true, force: true })
}
