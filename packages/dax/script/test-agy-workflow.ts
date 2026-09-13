// Opt-in end-to-end UAT. Creates/removes a DAX worktree; never applies its patch.
import { mkdtemp, writeFile, rm, access, realpath } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), "dax-agy-workflow-")))
process.env.DAX_TEST_HOME = scratch
const repository = await realpath(new URL("../../..", import.meta.url).pathname)
const filename = `agy-conversation-uat-${process.pid}.txt`
const check = path.join(scratch, "candidate.test.ts")
await writeFile(
  check,
  `import {test,expect} from "bun:test"; import {readFileSync} from "node:fs"; test("DAX observes READY",()=>expect(readFileSync(${JSON.stringify(filename)},"utf8").trim()).toBe("READY"));`,
)

const { Instance } = await import("../src/project/instance")
const { Session } = await import("../src/session")
const { SessionPrompt } = await import("../src/session/prompt")
const { compileWithRunId } = await import("../src/execution/compiler")
const { ContractGuardian } = await import("../src/execution/contract-guardian")
const { createEventAuthorityRun, transitionEventAuthority } = await import("../src/state/events/event-transitions")
const { getProjectedRunState } = await import("../src/state/events/run-event-store")
const { WorkerRunWorkflow } = await import("../src/workflows/worker-run")
const { AntigravityConversation } = await import("../src/worker/antigravity-conversation")
const { discoverAntigravityModels } = await import("../src/worker/antigravity-models")
const { redactEvidenceText } = await import("../src/worker/evidence-redaction")

try {
  await Instance.provide({
    directory: repository,
    fn: async () => {
      if (
        await access(path.join(repository, filename)).then(
          () => true,
          () => false,
        )
      )
        throw new Error("UAT target already exists.")
      const models = await discoverAntigravityModels({ forceRefresh: true })
      const model = process.env.DAX_AGY_UAT_MODEL ?? models[0].id
      if (!models.some((entry) => entry.id === model)) throw new Error("UAT model is not available through agy models")
      const session = await Session.create({ title: "AGY live conversation UAT" })
      const verificationTarget = path.relative(path.join(repository, ".dax", "worker-checkouts", session.id), check)
      const { contract } = compileWithRunId(
        {
          request: {
            intent: {
            input: `Create ${filename} as a normal workspace file containing exactly READY followed by a newline. Use the file-writing tool, not a shell command or artifact. Do not change any other file or run commands. DAX will run verification independently after you finish.`,
              repoPath: repository,
            },
            workflowHint: "worker_run",
            personaPreset: { personaId: "governed-worker", providerHint: "worker:antigravity", modelHint: model },
            workerConstraints: {
              conversation: {},
              writeScope: [filename],
              verification: [`bun test ${verificationTarget}`],
              egress: { filter: true, allowHosts: [] },
            },
          },
        },
        session.id,
      )
      await ContractGuardian.create(session.id, contract)
      await Session.bindGoverningRun(session.id, session.id)
      await createEventAuthorityRun(session.id, contract.contractId, true)
      await transitionEventAuthority(session.id, "queued", "execution_queued", {})
      await transitionEventAuthority(session.id, "running", "workflow_started", {})
      const workflow = new WorkerRunWorkflow({ runId: session.id, contract })
      const execution = workflow.execute()
      try {
        const deadline = Date.now() + 150_000
        for (;;) {
          const state = await Session.get(session.id)
          if (state.externalAgent?.phase === "ready") break
          const run = await getProjectedRunState(session.id)
          if (run?.status === "failed") throw new Error(run.error?.message ?? "AGY workflow failed")
          if (Date.now() > deadline) throw new Error("UAT response deadline exceeded")
          await Bun.sleep(250)
        }
        const reply = await SessionPrompt.prompt({
          sessionID: session.id,
          model: { providerID: "worker:antigravity", modelID: model },
          parts: [
            {
              type: "text",
              text: "What exact word did you write? Respond only with the word. Do not change any files.",
            },
          ],
        })
        if (!reply.parts.some((part) => part.type === "text" && part.text.trim() === "READY"))
          throw new Error("Follow-up context was not preserved")
        await AntigravityConversation.finish(session.id)
        const result = await execution
        const run = await getProjectedRunState(session.id)
        if (!result.success || run?.status !== "waiting_approval" || !run.governance.verification.satisfied)
          throw new Error(result.error ?? "Canonical verification/approval gate failed")
        if (
          await access(path.join(repository, filename)).then(
            () => true,
            () => false,
          )
        )
          throw new Error("Main checkout was modified")
        console.log(
          "PASS: session follow-up, observed patch, DAX verification, pending canonical approval, main checkout unchanged.",
        )
      } finally {
        AntigravityConversation.cancel(session.id)
        await execution
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
