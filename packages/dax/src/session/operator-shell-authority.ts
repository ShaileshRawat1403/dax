import { Agent } from "@/agent/agent"
import { resolveExecutionAuthority } from "@/execution/contract-guardian"
import { decideContractTool } from "@/execution/execution-contract"
import { Permission } from "@/governance"
import { NamedError } from "@dax-ai/util/error"
import { Session } from "."

export type OperatorShellAuthorization =
  | { governed: false }
  | { governed: true; disposition: "allowed"; contractId: string; governingRunId: string }

/** The operator's shell command was refused by the session's governing authority. */
export class OperatorShellDeniedError extends NamedError.Unknown {
  readonly code = "operator_shell_denied"
  constructor(
    public readonly reasonCode: "contract_tool_denied" | "contract_alias_executor_mismatch" | "permission_denied",
    public readonly contractId: string,
  ) {
    const message = `Operator shell denied: ${reasonCode}`
    super({ message })
    this.message = message
  }
}

/**
 * Decide whether the operator's direct shell may run in this session.
 *
 * A session with no governing contract is operator-direct and ungoverned, as it
 * always was. A session that has one is bound by it: a contract that does not
 * allow `shell`, or a permission rule that denies the command, refuses the
 * command before any process is launched. An unreadable governing reference
 * throws rather than being read as ungoverned.
 *
 * Only a denial refuses. A rule that would ask is not a second prompt here:
 * the operator typed the command, and that submission is the approval.
 */
export async function authorizeOperatorShell(input: {
  sessionID: string
  agent: string
  command: string
}): Promise<OperatorShellAuthorization> {
  const session = await Session.get(input.sessionID)
  const authority = await resolveExecutionAuthority(session.id, session.governingRunId)
  if (!authority.contract || !authority.governingRunId) return { governed: false }
  const { contract } = authority

  const decision = decideContractTool(contract, "shell", { kind: "builtin" })
  if (!decision.allowed) throw new OperatorShellDeniedError(decision.reasonCode, contract.contractId)

  const agent = await Agent.get(input.agent).catch(() => undefined)
  const rule = Permission.evaluate("shell", input.command, agent?.permission ?? [], session.permission ?? [])
  if (rule.action === "deny") throw new OperatorShellDeniedError("permission_denied", contract.contractId)

  return {
    governed: true,
    disposition: "allowed",
    contractId: contract.contractId,
    governingRunId: authority.governingRunId,
  }
}
