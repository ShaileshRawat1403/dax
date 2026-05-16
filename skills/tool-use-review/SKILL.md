---
name: "tool-use-review"
description: "Review the tools an AI agent has access to: over-broad permissions, side-effecting tools without approval gates, missing audit logs, dangerous defaults, schema correctness. Returns impact-ordered findings tables."
---

# Tool Use Review

Use this skill when the task is to review an agent's tool surface — the set of functions the model can call. Tools are where agents reach into the real world, and they are where things go wrong most expensively.

## Use when

- a new tool is being added to an agent
- the agent has accumulated tools over time and the surface needs a security pass
- a tool-related incident or near-miss occurred
- migrating from one tool framework to another and the schema needs review

## Workflow

1. **Inventory tools.** Find every tool the agent can invoke:
   - Code registrations (`registerTool`, `defineTool`, `Tool({...})`)
   - MCP server tools (read from MCP server schemas)
   - Plugin-contributed tools
   - Built-in agent tools enabled by configuration
2. **Classify by effect.**
   - **Read-only**: file reads, database SELECT, HTTP GET to safe endpoints
   - **Mutating, idempotent**: file writes that overwrite, configuration setters
   - **Mutating, non-idempotent**: appending, posting messages, sending emails, executing shell, calling third-party state-changing APIs
   - **Destructive**: deletions, drops, force-pushes, kill commands
   - **Externally visible**: anything that leaves the local machine and is observable by others (PRs, posts, deploys)
3. **Approval gates.**
   - Mutating + externally visible tools should require explicit approval unless explicitly opted out
   - Destructive tools should *always* require approval — flag any path where a destructive tool runs unattended
   - Approval prompts should describe the actual effect, not just the tool name
4. **Permission scope.**
   - File-write tools: do they accept any path, or is there a workspace boundary?
   - Shell tools: are dangerous commands (rm, dd, kill, systemctl) blocked or gated?
   - Network tools: domain allow/deny list, or unrestricted?
   - Credential tools: do they read from a secret store, or accept secrets as arguments?
5. **Default behavior.**
   - Dangerous defaults flagged: tools that auto-confirm, tools that default to broad scope, tools that hide their effect in the response
   - Tools where the *absence* of an argument means "act on everything"
6. **Audit and traceability.**
   - Every tool call emits an audit record with: tool name, arguments, caller (agent / session / user), result, timestamp
   - Audit records are append-only and tied to a session id
   - Sensitive arguments (tokens, full file contents) are redacted before audit write
7. **Schema correctness.**
   - JSON schemas match the runtime parameter types
   - Required vs optional fields are accurate
   - Enums are exhaustive (no silent "other" branch)
   - Descriptions tell the model what the tool actually does, with caveats
8. **Failure modes.**
   - Tool errors return structured errors, not stack traces
   - Timeouts present and reasonable
   - Retries bounded and idempotent-only
9. **Composition risk.**
   - Multi-step compositions (read file → shell exec → write file) that bypass an approval that would have caught any single step
   - Tools that can be chained to escalate privilege (e.g., read .env → call API → write to repo)

## Checks

- Distinguish "could be misused" (Medium) from "will be misused" (Critical/High)
- For DAX specifically: the RAO loop, runtime guard, and policy engine sit between the model and most tools — credit the existing gates and focus findings on what slips past them
- Tools that exist only in test/dev paths can be Lower severity unless they leak into production builds

## Output contract

Findings follow [docs/skills/OUTPUT_CONTRACT.md](../../docs/skills/OUTPUT_CONTRACT.md).

Return:

1. **Verdict** — one line + a small table:
   - `Tools registered`, `Mutating`, `Destructive`, `Requires approval`, `Audited`
2. **Counts** — Critical/High/Medium/Low/Info totals
3. **Findings** — one table per category, ordered by impact:
   - Missing approval gates on destructive/externally-visible tools
   - Permission scope and workspace boundaries
   - Dangerous defaults
   - Audit and traceability gaps
   - Schema correctness
   - Composition / privilege escalation paths
4. **Open questions / assumptions** — intended approval policy, intended workspace boundary
5. **Residual risk** — runtime-only properties not visible from the static review
6. **Next actions** — concrete fixes ordered by impact

## Evidence to collect

- Tool name + registration file:line for each tool
- Schema and description verbatim
- Approval / governance hook attached (or its absence)
- Audit emission site for each tool (or its absence)
- Default values for each parameter that has one
