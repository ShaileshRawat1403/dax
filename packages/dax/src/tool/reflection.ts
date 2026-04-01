import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { SessionV2 } from "../session/model"

export const ReflectionTool = Tool.define("reflection", {
  description:
    "Record structured reflection on current thinking, assumptions, and next steps. Use this before taking significant actions.",
  parameters: z.object({
    goal: z.string().describe("What you're trying to accomplish"),
    outcome_expected: z.string().describe("What outcome you expect from this action"),
    assumptions: z.array(z.string()).describe("Things you're assuming to be true without explicit confirmation"),
    ambiguities: z.array(z.string()).describe("Things that are unclear or could be interpreted multiple ways"),
    risks: z
      .array(
        z.object({
          level: z.enum(["low", "medium", "high"]).describe("Risk severity"),
          item: z.string().describe("What could go wrong"),
          mitigation: z.string().optional().describe("How you're mitigating this risk"),
        }),
      )
      .describe("Potential issues that could arise from this plan"),
    alternatives: z
      .array(
        z.object({
          id: z.string().describe("Alternative identifier"),
          path: z.string().describe("Description of alternative approach"),
          tradeoff: z.string().describe("Tradeoff vs current approach"),
        }),
      )
      .describe("Other approaches you considered"),
    decision: z
      .enum(["proceed", "ask", "branch", "stop"])
      .describe(
        "Your decision: proceed (go ahead), ask (need user input), branch (need new context), stop (cannot continue)",
      ),
    justification: z.string().optional().describe("Why this is the right path"),
    confidence: z.number().min(0).max(1).describe("How confident you are (0-1)"),
    requiresApproval: z.boolean().describe("Whether this action requires explicit operator approval"),
    verificationPlan: z.array(z.string()).describe("Steps you'll take to verify the action worked correctly"),
  }),
  async execute(params, ctx) {
    const reflection: SessionV2.Reflection = {
      goal: params.goal,
      outcome_expected: params.outcome_expected,
      assumptions: params.assumptions,
      ambiguities: params.ambiguities,
      risks: params.risks,
      alternatives: params.alternatives,
      decision: params.decision,
      justification: params.justification,
      confidence: params.confidence,
      requiresApproval: params.requiresApproval,
      verificationPlan: params.verificationPlan,
      timestamp: new Date().toISOString(),
    }

    await Session.update(ctx.sessionID, (draft) => {
      const currentState = draft.state_v2 ?? {
        activity_timeline: [],
        approvals: [],
        artifacts: [],
        audit_findings: [],
      }
      draft.state_v2 = {
        ...currentState,
        reflection: {
          goal: params.goal,
          outcome_expected: params.outcome_expected,
          assumptions: params.assumptions,
          ambiguities: params.ambiguities,
          risks: params.risks,
          alternatives: params.alternatives,
          decision: params.decision,
          justification: params.justification,
          confidence: params.confidence,
          requiresApproval: params.requiresApproval,
          verificationPlan: params.verificationPlan,
          timestamp: new Date().toISOString(),
        },
      }
    })

    const riskSummary = params.risks.map((r) => `[${r.level.toUpperCase()}] ${r.item}`).join(", ")
    const decisionLabel = params.decision.toUpperCase()
    const approvalFlag = params.requiresApproval ? "⚠️ APPROVAL REQUIRED" : ""

    return {
      title: "Reflection recorded",
      output: `${decisionLabel}: ${params.goal}${approvalFlag ? ` ${approvalFlag}` : ""}${riskSummary ? `\nRisks: ${riskSummary}` : ""}`,
      metadata: { reflection: true },
    }
  },
})
