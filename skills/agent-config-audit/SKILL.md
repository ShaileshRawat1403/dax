---
name: "agent-config-audit"
description: "Audit agent configuration surfaces (AGENTS.md, CLAUDE.md, MCP servers, tool registrations, settings, hooks) for consistency, contradictions, and silent overrides. Returns impact-ordered findings tables."
---

# Agent Config Audit

Use this skill when the task is to review the *static* configuration that shapes an AI agent's behavior in a repo. These surfaces accumulate over time: a rule added in one place, an override in another, a hook in a third — and they drift apart. This skill finds the drift.

## Use when

- the project has multiple agent surfaces (AGENTS.md, CLAUDE.md, OpenAI Agent docs, MCP configs) and the user wonders if they agree
- a rule "is supposed to apply" but does not
- a new contributor will be added and the question is which surface they need to read
- a third-party agent is being introduced and the team wants to know what surfaces it will or will not respect

## Workflow

1. **Inventory the surfaces.** Look for:
   - `AGENTS.md`, `CLAUDE.md`, `.cursor/rules`, `.cursorrules`, `.aider*`
   - `.claude/settings.json`, `.claude/settings.local.json`, `.claude/hooks/`
   - MCP server configs (`mcp.json`, `.mcp/`, app-specific config dirs)
   - Tool registration code (anything that calls `registerTool`, `defineTool`, or builds a tool registry)
   - Skill / instruction directories (`skills/`, `instructions/`)
   - `.github/copilot-instructions.md` if present
   - Provider-specific docs in `docs/` that prescribe agent behavior
2. **Map authority.** For each surface, record:
   - Which agent(s) read it
   - Whether it is committed or local-only (gitignored)
   - Whether it overrides another surface (and how — precedence rules)
3. **Rule extraction.** Pull the explicit rules from each surface into a normalized list: "agent X must / must not / should…"
4. **Cross-surface comparison.**
   - Identify rules that appear in only one surface
   - Identify rules that contradict between surfaces
   - Identify rules that *appear* to agree but use different vocabulary for the same thing (e.g., "feature branch" vs "topic branch")
5. **Hook and gate verification.**
   - For each hook (Claude Code, git hooks, pre-tool gates, runtime guards), confirm:
     - The trigger condition matches the documented rule
     - Failure messages reference the canonical surface
     - The bypass path (if any) is documented in the surface that describes the rule
6. **Tool registration consistency.**
   - Tools described in the agent prompt actually exist
   - Tool schemas match between the registration and the documentation
   - Tools that require approval are flagged as such in their description
7. **MCP server health.**
   - Each declared MCP server has a working command and known transport
   - Secrets referenced by MCP servers exist (env var names match)
   - Stale MCP entries pointing to removed binaries flagged
8. **Local vs committed.**
   - Rules that exist only in local settings (e.g., `.claude/settings.local.json` when `.claude/` is gitignored) are flagged with their team-coverage implication
   - Recommend committed equivalents when the rule should apply to everyone

## Checks

- Some surfaces are *intentionally* local-only (personal preferences, machine-specific paths) — do not flag those
- Treat `AGENTS.md` as the canonical written rule unless the repo declares otherwise
- For DAX specifically: `AGENTS.md` is canonical, `CLAUDE.md` is a Claude-specific entry point, `.githooks/` is the cross-contributor backstop, `.claude/settings.local.json` is per-user

## Output contract

Findings follow [docs/skills/OUTPUT_CONTRACT.md](../../docs/skills/OUTPUT_CONTRACT.md).

Return:

1. **Verdict** — one line + a small table:
   - `Surfaces found`, `Agents covered`, `Hooks active`, `MCP servers`, `Local-only surfaces`
2. **Counts** — Critical/High/Medium/Low/Info totals
3. **Findings** — one table per category, ordered by impact:
   - Contradictions between surfaces
   - Rules in only one place that should apply everywhere
   - Hooks not matching their documented rule
   - Tool registration / documentation drift
   - MCP server health
   - Local-only rules that should be committed
4. **Open questions / assumptions** — intended canonical surface, intended audience
5. **Next actions** — for each contradiction, recommend which surface wins and which to align

## Evidence to collect

- File path for every surface
- The normalized rule list with its source surface
- Hook trigger expressions verbatim
- MCP server command + transport for each declared server
- Tool name, schema reference, and prompt mention for each tool
