import { Instance } from "@/project/instance"
import { Storage } from "@/storage/storage"
import path from "path"
import { rm } from "fs/promises"
import type { ExecutionContract } from "@/execution/execution-contract"
import type { WorkflowClass } from "@/execution/workflow-class"
import { createEventAuthorityRun, transitionEventAuthority } from "@/state/events/event-transitions"
import { readRunEvents, projectRunStateFromEvents } from "@/state/events/run-event-store"
import type { RunEventEnvelope } from "@/state/events/run-event-types"
import type { RunState } from "@/state/events/run-reducer"
import { createWorkflow, type Workflow } from "./registry"

/**
 * Workflow event harness — drive a governed workflow against the real event
 * store and capture every event it emits.
 *
 * DAX's governance thesis is that every claim lands as an event on the run
 * log: contracts refined, sandbox containment, verification receipts, scope
 * provenance. Before this harness existed no test could observe an emitted
 * event end to end, so call sites that route evidence (the provider registry)
 * and payloads that carry it (`reapedDescendants`, `providerId`) were
 * unassertable. This closes that gap for the workflow it drives and every
 * workflow that lands after it.
 *
 * The harness mirrors the production run path in `createRunFromContract` for
 * the event-authority branch: contract_compiled, execution_queued, then
 * workflow_started, then `workflow.execute()`. Session, compiler, shadow
 * auditor and plan-quality plumbing are intentionally out of scope — the
 * contract is provided by the caller and side effects are injected by the
 * workflow's own test seam (e.g. `WorkerRunEffects`).
 *
 * Isolation contract:
 * - `DAX_TEST_HOME` should be set (and stable for the process lifetime — the
 *   storage root is lazily cached) so standalone runs land in a temp home,
 *   never the operator's real one. Inside the full suite an earlier test file
 *   may pin the storage root first; that is why the hard guarantees below
 *   exist rather than relying on the env alone.
 * - `runId` must be unique per run — including across processes, because a
 *   pinned storage root can be shared with earlier suite runs. `events` are
 *   read back for that run only.
 * - Every run the harness creates is recorded so `cleanupHarnessRuns()` can
 *   remove its events and authority keys from whatever root was pinned, even
 *   a shared one.
 */
const createdRuns: Array<{ runId: string; projectId: string }> = []

export async function runWorkflowAndCaptureEvents(input: {
  workflowClass: WorkflowClass
  contract: ExecutionContract
  directory: string
}): Promise<{
  runId: string
  contract: ExecutionContract
  result: Awaited<ReturnType<Workflow["execute"]>>
  events: RunEventEnvelope[]
  state: RunState | null
}> {
  return Instance.provide({
    directory: input.directory,
    fn: async () => {
      createdRuns.push({ runId: input.contract.runId, projectId: Instance.project.id })
      await createEventAuthorityRun(input.contract.runId, input.contract.contractId)
      await transitionEventAuthority(input.contract.runId, "queued", "execution_queued", {})
      await transitionEventAuthority(input.contract.runId, "running", "workflow_started", {})

      const workflow = createWorkflow(input.workflowClass, {
        runId: input.contract.runId,
        contract: input.contract,
      })
      if (!workflow) {
        throw new Error(`no workflow registered for class "${input.workflowClass}"`)
      }

      const result = await workflow.execute()
      const events = await readRunEvents(input.contract.runId)
      const state = await projectRunStateFromEvents(input.contract.runId)

      return {
        runId: input.contract.runId,
        contract: input.contract,
        result,
        events,
        state,
      }
    },
  })
}

export function eventByType(events: RunEventEnvelope[], type: string): RunEventEnvelope[] {
  return events.filter((event) => event.type === type)
}

export function firstEventByType(events: RunEventEnvelope[], type: string): RunEventEnvelope | undefined {
  return events.find((event) => event.type === type)
}

export async function cleanupHarnessRuns(): Promise<void> {
  for (const { runId, projectId } of createdRuns) {
    await Storage.remove(["run_events", projectId, runId, "events.json"]).catch(() => {})
    await Storage.remove(["run_authority", projectId, runId, "authority.json"]).catch(() => {})
    const root = await Storage.dir()
    await rm(path.join(root, "run_events", projectId, runId), { recursive: true, force: true }).catch(() => {})
    await rm(path.join(root, "run_authority", projectId, runId), { recursive: true, force: true }).catch(() => {})
  }
  createdRuns.length = 0
}
