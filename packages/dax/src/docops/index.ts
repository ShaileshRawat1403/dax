import path from "path"
import { existsSync } from "fs"
import z from "zod"
import { Instance } from "@/project/instance"
import { $ } from "bun"

export namespace DocOps {
  export const Mode = z.enum(["guide", "spec", "release-notes", "qa"])
  export type Mode = z.infer<typeof Mode>

  export const Severity = z.enum(["critical", "high", "medium", "low", "info"])
  export type Severity = z.infer<typeof Severity>

  export const Status = z.enum(["pass", "warn", "fail"])
  export type Status = z.infer<typeof Status>

  export const Check = z.object({
    id: z.string(),
    severity: Severity,
    category: z.string(),
    title: z.string(),
    evidence: z.string(),
    fix: z.string(),
    blocking: z.boolean(),
  })
  export type Check = z.infer<typeof Check>

  export const Result = z.object({
    run_id: z.string(),
    timestamp: z.string(),
    mode: Mode,
    status: Status,
    title: z.string(),
    content: z.string(),
    checks: z.array(Check),
    summary: z.object({
      blocker_count: z.number().int().nonnegative(),
      warning_count: z.number().int().nonnegative(),
      info_count: z.number().int().nonnegative(),
    }),
    next_actions: z.array(z.string()),
  })
  export type Result = z.infer<typeof Result>

  type Context = {
    root: string
    repoName: string
    hasGit: boolean
    branch: string
    dirty: boolean
  }

  function rootDir() {
    try {
      return Instance.worktree
    } catch {
      return process.cwd()
    }
  }

  async function context(): Promise<Context> {
    const root = rootDir()
    const repoName = path.basename(root)
    const hasGit = existsSync(path.join(root, ".git"))
    const branch = hasGit
      ? await $`git rev-parse --abbrev-ref HEAD`
          .text()
          .then((x) => x.trim())
          .catch(() => "unknown")
      : "none"
    const dirty = hasGit
      ? await $`git status --porcelain`
          .text()
          .then((x) => x.trim().length > 0)
          .catch(() => false)
      : false
    return { root, repoName, hasGit, branch, dirty }
  }

  function heading(text: string, name: string) {
    const re = new RegExp(`^#+\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "im")
    return re.test(text)
  }

  function parseLinks(text: string) {
    const out: string[] = []
    const re = /\[[^\]]+\]\(([^)]+)\)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const link = m[1]?.trim()
      if (!link) continue
      out.push(link)
    }
    return out
  }

  function parseCodePaths(text: string) {
    const out: string[] = []
    const re = /`([^`]+)`/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const value = m[1]?.trim()
      if (!value) continue
      if (value.startsWith("/") || value.includes("/") || value.endsWith(".md") || value.endsWith(".ts")) out.push(value)
    }
    return out
  }

  function checkMarkdownFile(input: {
    root: string
    file: string
    requiredHeadings?: string[]
    checks: Check[]
  }) {
    const fullPath = path.join(input.root, input.file)
    if (!existsSync(fullPath)) {
      input.checks.push({
        id: `docs.file.missing.${input.file.replace(/[/.]/g, "_")}`,
        severity: "high",
        category: "documentation",
        title: "Documentation file is missing",
        evidence: input.file,
        fix: `Create ${input.file} and add required sections.`,
        blocking: true,
      })
      return
    }
    const text = Bun.file(fullPath).text()
    return text.then((content) => {
      for (const section of input.requiredHeadings ?? []) {
        if (!heading(content, section)) {
          input.checks.push({
            id: `docs.section.missing.${input.file.replace(/[/.]/g, "_")}.${section.toLowerCase().replace(/\s+/g, "_")}`,
            severity: "medium",
            category: "documentation",
            title: "Required section missing",
            evidence: `${input.file} -> ${section}`,
            fix: `Add section heading "${section}" to ${input.file}.`,
            blocking: false,
          })
        }
      }

      for (const link of parseLinks(content)) {
        if (link.startsWith("http://") || link.startsWith("https://") || link.startsWith("#")) continue
        if (!existsSync(path.join(input.root, link))) {
          input.checks.push({
            id: `docs.link.broken.${input.file.replace(/[/.]/g, "_")}.${link.replace(/[/.]/g, "_")}`,
            severity: "medium",
            category: "documentation",
            title: "Broken relative link",
            evidence: `${input.file} -> ${link}`,
            fix: `Fix or remove broken link ${link} in ${input.file}.`,
            blocking: false,
          })
        }
      }

      for (const p of parseCodePaths(content)) {
        if (p.startsWith("http://") || p.startsWith("https://")) continue
        if (p.includes(" ")) continue
        const rel = p.startsWith("/") ? p.slice(1) : p
        if (!existsSync(path.join(input.root, rel))) continue
      }
    })
  }

  function summarize(checks: Check[]) {
    const blocker_count = checks.filter((c) => c.blocking).length
    const warning_count = checks.filter((c) => !c.blocking && c.severity !== "info").length
    const info_count = checks.filter((c) => c.severity === "info").length
    const status: Status = blocker_count > 0 ? "fail" : warning_count > 0 ? "warn" : "pass"
    return { blocker_count, warning_count, info_count, status }
  }

  function buildGuide(ctx: Context, topic?: string) {
    const subject = topic?.trim() || `${ctx.repoName} workflow`
    return [
      `# User Guide: ${subject}`,
      "",
      "## Purpose",
      `This guide explains how to use ${ctx.repoName} safely and effectively.`,
      "",
      "## Audience",
      "- Engineers and operators",
      "- Non-developer collaborators",
      "",
      "## Prerequisites",
      "- Required credentials and environment access",
      "- Local toolchain installed",
      "",
      "## Step-by-step Workflow",
      "1. Prepare environment and verify access.",
      "2. Run the task in a small scoped iteration.",
      "3. Review outputs and approvals before next step.",
      "",
      "## Troubleshooting",
      "- Validate auth, model/provider selection, and command output.",
      "- Re-run diagnostics for failing paths.",
      "",
      "## Validation",
      "- Expected commands complete successfully.",
      "- Artifacts and logs show intended outcomes.",
      "",
      "## Next Actions",
      "1. Add screenshots for key UI moments.",
      "2. Link this guide from docs/README.md.",
    ].join("\n")
  }

  function buildSpec(ctx: Context, topic?: string) {
    const subject = topic?.trim() || "Feature Specification"
    return [
      `# Spec: ${subject}`,
      "",
      "## Purpose",
      "Define scope, constraints, and acceptance criteria for implementation.",
      "",
      "## Scope",
      "- In scope: clearly defined deliverables",
      "- Out of scope: deferred capabilities",
      "",
      "## Architecture",
      "- Data flow",
      "- Control flow",
      "- Failure modes",
      "",
      "## Risks",
      "- Operational risk and mitigation",
      "- Security and policy risk",
      "",
      "## Acceptance Criteria",
      "1. Typecheck and tests pass.",
      "2. User-visible behavior is documented.",
      "3. Rollback path exists.",
      "",
      "## Release Plan",
      `- Branch: ${ctx.branch}`,
      `- Working tree clean before release: ${ctx.dirty ? "no" : "yes"}`,
    ].join("\n")
  }

  function buildReleaseNotes(ctx: Context, topic?: string) {
    const subject = topic?.trim() || "Current Release"
    return [
      `# Release Notes: ${subject}`,
      "",
      "## Highlights",
      "- Summary of major user-facing changes",
      "- Summary of reliability/governance improvements",
      "",
      "## Breaking Changes",
      "- None listed (update as needed)",
      "",
      "## Fixes",
      "- Auth, stability, and workflow fixes",
      "",
      "## Upgrade Guidance",
      "1. Update to latest release.",
      "2. Re-run auth diagnostics.",
      "3. Validate critical workflows and CI checks.",
      "",
      "## Verification",
      "- `bun run release:verify`",
      `- Git branch: ${ctx.branch}`,
      `- Git repo detected: ${ctx.hasGit ? "yes" : "no"}`,
    ].join("\n")
  }

  export async function run(input: { mode: Mode; topic?: string }): Promise<Result> {
    const ctx = await context()
    const checks: Check[] = []
    let content = ""
    let title = ""

    if (input.mode === "guide") {
      title = "Guide Draft"
      content = buildGuide(ctx, input.topic)
    } else if (input.mode === "spec") {
      title = "Spec Draft"
      content = buildSpec(ctx, input.topic)
    } else if (input.mode === "release-notes") {
      title = "Release Notes Draft"
      content = buildReleaseNotes(ctx, input.topic)
    } else {
      title = "Documentation QA"
      await Promise.all([
        checkMarkdownFile({
          root: ctx.root,
          file: "README.md",
          requiredHeadings: ["Overview", "Quickstart"],
          checks,
        }),
        checkMarkdownFile({
          root: ctx.root,
          file: "docs/README.md",
          requiredHeadings: ["Start Here", "Non-Developers", "Developers"],
          checks,
        }),
        checkMarkdownFile({
          root: ctx.root,
          file: "docs/non-dev-quickstart.md",
          requiredHeadings: ["What DAX Does In Plain Language", "10-Minute Flow", "Common Fixes"],
          checks,
        }),
      ])
      const qa = summarize(checks)
      content = [
        `## Docs QA`,
        `- status: ${qa.status}`,
        `- blockers: ${qa.blocker_count}`,
        `- warnings: ${qa.warning_count}`,
        `- info: ${qa.info_count}`,
        "",
        ...(checks.length
          ? ["### Findings", ...checks.map((c) => `- [${c.blocking ? "BLOCKER" : c.severity.toUpperCase()}] ${c.title}: ${c.evidence}`)]
          : ["No documentation issues detected in baseline checks."]),
      ].join("\n")
    }

    const resultSummary = summarize(checks)
    const next_actions = checks.length
      ? checks.slice(0, 3).map((c) => `Fix: ${c.title}`)
      : [
          input.mode === "qa"
            ? "No blockers found. Keep docs QA in release workflow."
            : "Review draft and tailor examples/screenshots to user audience.",
        ]

    return {
      run_id: `docs_${Date.now().toString(36)}`,
      timestamp: new Date().toISOString(),
      mode: input.mode,
      status: input.mode === "qa" ? resultSummary.status : "pass",
      title,
      content,
      checks,
      summary: {
        blocker_count: resultSummary.blocker_count,
        warning_count: resultSummary.warning_count,
        info_count: resultSummary.info_count,
      },
      next_actions,
    }
  }

  export function toMarkdown(result: Result) {
    const lines = [
      `## Docs Result`,
      `- run_id: ${result.run_id}`,
      `- mode: ${result.mode}`,
      `- status: ${result.status}`,
      `- blockers: ${result.summary.blocker_count}`,
      `- warnings: ${result.summary.warning_count}`,
      `- info: ${result.summary.info_count}`,
      "",
      result.content,
    ]
    if (result.next_actions.length > 0) {
      lines.push("", "### Next Actions")
      result.next_actions.forEach((action, i) => lines.push(`${i + 1}. ${action}`))
    }
    return lines.join("\n")
  }
}
