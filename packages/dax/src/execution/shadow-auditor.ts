import { generateObject } from "ai"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { Instance } from "@/project/instance"
import { SessionV2 } from "@/session/model"
import { ExecutionContract } from "./execution-contract"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"

const log = Log.create({ service: "shadow-auditor" })

export namespace ShadowAuditor {
  /**
   * Estimate the blast radius of a compiled contract before any tool runs.
   *
   * Fire-and-forget by design, so it must never reach a provider in an
   * environment that has not opted into live model calls. Test runs set
   * `DAX_DISABLE_SHADOW_AUDIT`, which is why a suite with no provider
   * credentials no longer logs an auth failure inside an otherwise green run.
   */
  export async function analyze(sessionID: string, prompt: string, contract: ExecutionContract) {
    if (Flag.DAX_DISABLE_SHADOW_AUDIT) return
    try {
      const defaultModel = await Provider.defaultModel()
      if (!defaultModel) return

      const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
      if (!model) return

      const result = await generateObject({
        model: await Provider.getLanguage(model),
        schema: SessionV2.BlastRadiusState.omit({ analyzedAt: true }),
        system: `You are the DAX Shadow Auditor. Your job is to proactively evaluate a planned execution contract before any tools run.
You must determine the 'blast radius' of the planned changes based on the user's intent and the execution contract.
Evaluate if the changes are low, medium, high, or critical risk based on what files will be modified, how many files, and what subsystems are affected.
If it modifies core files, configuration files, or many files (e.g. > 5), it should be flagged as 'high' or 'critical'.
Return a concise reason and a list of affected areas.`,
        prompt: `Intent:\n${prompt}\n\nExecution Contract:\n${JSON.stringify(contract, null, 2)}\n\nRepository: ${Instance.worktree}\n\nDetermine the blast radius of this plan.`,
      })

      await Session.update(sessionID, (draft) => {
        if (draft.state_v2) {
          draft.state_v2.blast_radius = {
            ...result.object,
            analyzedAt: new Date().toISOString(),
          }
        }
      })
    } catch (error) {
      log.error("ShadowAuditor analysis failed", { error, sessionID })
    }
  }
}
