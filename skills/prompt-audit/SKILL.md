---
name: "prompt-audit"
description: "Audit prompts and system instructions across a repo for hygiene: hardcoded model assumptions, secret leakage, drift between surfaces, length budget, injection resistance. Returns impact-ordered findings tables."
---

# Prompt Audit

Use this skill when the task is to review the prompts, system instructions, and template strings an AI application sends to a model. Prompts in a real codebase rot quickly — model assumptions get hardcoded, secrets get pasted in for "just one experiment," and surfaces drift apart silently.

## Use when

- a new model is being adopted and the team wants to know which prompts will break
- a prompt-injection incident or near-miss prompted a review
- prompts have spread across multiple files and no one is sure which is canonical
- the project is moving from in-source prompts to an external prompt store

## Workflow

1. **Locate prompts.** Search for:
   - Files named `prompts/`, `prompt.*`, `system.*`, `instructions.*`, `*.md` in agent-specific dirs
   - Calls to `messages.create`, `chat.completions`, `generateText`, `streamText`, `Anthropic.messages.*`, `OpenAI.chat.*`, provider-specific equivalents
   - Multi-line template literals containing `You are` or `Your task is`
2. **Classify each prompt by role.** System / developer / user / assistant prefill. Note where each lives in the call site.
3. **Model assumptions.**
   - Hardcoded model names (`gpt-4`, `claude-3-opus-20240229`) embedded in prompt text rather than configuration
   - Token-count assumptions ("answer in 200 tokens") that break across families
   - Format expectations (XML tags, JSON shapes) that assume a specific model's training
   - Prompts that mention features only available on one provider (Anthropic system prompts vs OpenAI system messages, etc.)
4. **Secret and PII leakage.**
   - Embedded API keys, tokens, internal URLs in example values
   - Real user data used as few-shot examples
   - Internal employee names or system identifiers that should not leave the company
5. **Drift between surfaces.**
   - Same agent persona defined differently in two places
   - Documentation describing one behavior, prompt implementing another
   - Tool descriptions in the prompt disagreeing with tool schemas
6. **Length and budget.**
   - Prompts that grow without bound (history concatenation, retrieved-context append)
   - Hardcoded length budgets that no longer match the deployed model's context window
   - Prompts longer than 4k tokens that nobody has measured
7. **Injection resistance.**
   - User input concatenated directly into a system prompt
   - Tool output rendered without sanitization (especially for code-execution tools that can return crafted strings)
   - Prompt closures (the model treating later user text as instruction) — flag missing delimiters or instruction-hierarchy patterns
8. **Determinism and reproducibility.**
   - Wall-clock timestamps inside prompts that vary per call
   - Random sample selections without seed
   - Implicit dependence on the order of items in a set / dict
9. **Test coverage.**
   - Prompts have eval coverage (see [eval-suite-audit](../eval-suite-audit/SKILL.md))
   - Regression fixtures exist for the prompts the team has changed in the last quarter

## Checks

- Distinguish "prompt is unsafe" (Critical/High) from "prompt is stylistically inconsistent" (Medium/Low)
- Hardcoded model names in tests and migration scripts are usually fine — flag them only in production paths
- Multi-language prompts (translated prompts) need separate review per language
- For DAX: prompts live in `packages/dax/src/session/prompt.ts` and across provider plugins under `packages/dax/src/plugin/*`

## Output contract

Findings follow [docs/skills/OUTPUT_CONTRACT.md](../../docs/skills/OUTPUT_CONTRACT.md).

Return:

1. **Verdict** — one line + a small table:
   - `Prompts found`, `Surfaces`, `Models referenced`, `Eval coverage?`
2. **Counts** — Critical/High/Medium/Low/Info totals
3. **Findings** — one table per category, ordered by impact:
   - Secret and PII leakage
   - Injection resistance
   - Model assumptions
   - Drift between surfaces
   - Length and budget
   - Determinism
   - Test coverage
4. **Open questions / assumptions** — intended canonical surface, intended model family
5. **Residual risk** — anything that depends on runtime (real user inputs, real retrieved context)
6. **Next actions** — concrete fixes ordered by impact

## Evidence to collect

- File path + line for every prompt site
- The exact prompt text (or its first 200 chars + last 200 chars for long ones)
- The model name and provider at the call site
- The data flow that feeds into the prompt (user input, tool output, retrieval)
- Any eval suite that exercises the prompt
