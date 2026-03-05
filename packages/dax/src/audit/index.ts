import z from "zod"
import { existsSync } from "fs"
import path from "path"
import { $ } from "bun"
import { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import { Instance } from "@/project/instance"
import { PM } from "@/pm"

export namespace Audit {
  export const Trigger = z.enum([
    "manual",
    "before_release",
    "after_pr_review",
    "after_config_change",
    "after_docs_policy_change",
  ])
  export type Trigger = z.infer<typeof Trigger>

  export const Profile = z.enum(["strict", "balanced", "advisory"])
  export type Profile = z.infer<typeof Profile>

  export const Severity = z.enum(["critical", "high", "medium", "low", "info"])
  export type Severity = z.infer<typeof Severity>

  export const Status = z.enum(["pass", "warn", "fail"])
  export type Status = z.infer<typeof Status>

  export const Finding = z.object({
    id: z.string(),
    severity: Severity,
    category: z.string(),
    title: z.string(),
    evidence: z.string(),
    impact: z.string(),
    fix: z.string(),
    owner_hint: z.string(),
    blocking: z.boolean(),
  })
  export type Finding = z.infer<typeof Finding>

  export const Summary = z.object({
    blocker_count: z.number().int().nonnegative(),
    warning_count: z.number().int().nonnegative(),
    info_count: z.number().int().nonnegative(),
  })
  export type Summary = z.infer<typeof Summary>

  export const Result = z.object({
    run_id: z.string(),
    timestamp: z.string(),
    profile: Profile,
    status: Status,
    findings: z.array(Finding),
    summary: Summary,
    next_actions: z.array(z.string()),
    metadata: z.object({
      trigger: Trigger,
      project_id: z.string(),
      github_enabled: z.boolean(),
      auto_triggers: z.array(z.string()),
    }),
  })
  export type Result = z.infer<typeof Result>

  const DEFAULT_FAIL_ON = ["security", "auth", "policy", "release", "test", "documentation"]
  const REQUIRED_RELEASE_FILES = ["packages/dax/script/build.ts", "script/install.sh", "README.md", "docs/prerelease.md"]

  function parseProfile(value: string | undefined): Profile | undefined {
    if (!value) return
    const lowered = value.toLowerCase()
    if (lowered === "strict" || lowered === "balanced" || lowered === "advisory") return lowered
    return
  }

  function csv(input: string | undefined) {
    if (!input) return []
    return input
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  }

  export function resolveSettings(config: Config.Info) {
    const profile =
      parseProfile(Flag.DAX_AUDIT_PROFILE) ?? parseProfile(config.audit?.profile) ?? ("strict" satisfies Profile)
    const auto_triggers = Array.from(
      new Set([...(config.audit?.auto_triggers ?? []), ...csv(Flag.DAX_AUDIT_AUTOTRIGGERS)]),
    ).filter((t) => Trigger.safeParse(t).success)
    const fail_on = config.audit?.fail_on?.length ? config.audit.fail_on : DEFAULT_FAIL_ON
    const enabled = Flag.DAX_AUDIT_BETA || config.audit?.enabled === true
    const github_enabled = config.integration?.github?.enabled === true
    return { enabled, profile, auto_triggers, fail_on, github_enabled }
  }

  export function shouldAutoTrigger(input: { trigger: Trigger; config: Config.Info }) {
    const settings = resolveSettings(input.config)
    if (!settings.enabled) return false
    if (input.trigger === "manual") return false
    return settings.auto_triggers.includes(input.trigger)
  }

  function isBlocking(input: { severity: Severity; category: string; profile: Profile; fail_on: string[] }) {
    if (input.profile === "advisory") return false
    if (input.profile === "balanced") return input.severity === "critical"
    if (input.severity === "critical") return true
    if (input.severity === "high" && input.fail_on.includes(input.category)) return true
    return false
  }

  function finding(input: Omit<Finding, "blocking"> & { profile: Profile; fail_on: string[] }): Finding {
    return {
      ...input,
      blocking: isBlocking({
        severity: input.severity,
        category: input.category,
        profile: input.profile,
        fail_on: input.fail_on,
      }),
    }
  }

  export async function run(input?: {
    trigger?: Trigger
    profile?: Profile
    config?: Config.Info
  }): Promise<Result> {
    const trigger = input?.trigger ?? "manual"
    const config = input?.config ?? (await Config.get())
    const settings = resolveSettings(config)
    const profile = input?.profile ?? settings.profile
    const fail_on = settings.fail_on
    const findings: Finding[] = []

    for (const file of REQUIRED_RELEASE_FILES) {
      if (!existsSync(path.join(Instance.worktree, file))) {
        findings.push(
          finding({
            id: `release.missing-file.${file.replace(/[/.]/g, "_")}`,
            severity: "high",
            category: "release",
            title: "Required release file is missing",
            evidence: file,
            impact: "Release pipeline may fail or ship incomplete artifacts.",
            fix: `Add the missing file: ${file}`,
            owner_hint: "release engineering",
            profile,
            fail_on,
          }),
        )
      }
    }

    const pkgPath = path.join(Instance.worktree, "package.json")
    if (!existsSync(pkgPath)) {
      findings.push(
        finding({
          id: "release.package-json.missing",
          severity: "critical",
          category: "release",
          title: "package.json not found",
          evidence: pkgPath,
          impact: "Cannot verify scripts, build, test, or release workflows.",
          fix: "Restore package.json at the repository root.",
          owner_hint: "build engineering",
          profile,
          fail_on,
        }),
      )
    } else {
      const pkg = await Bun.file(pkgPath)
        .json()
        .catch(() => ({} as any))
      const scripts = (pkg as any).scripts ?? {}
      for (const requiredScript of ["test", "typecheck:dax", "release:verify"]) {
        if (typeof scripts[requiredScript] !== "string") {
          findings.push(
            finding({
              id: `test.script.missing.${requiredScript.replace(/[:]/g, "_")}`,
              severity: requiredScript === "release:verify" ? "high" : "medium",
              category: "test",
              title: "Required verification script is missing",
              evidence: `scripts.${requiredScript}`,
              impact: "Automated SDLC verification is incomplete.",
              fix: `Define scripts.${requiredScript} in package.json.`,
              owner_hint: "build engineering",
              profile,
              fail_on,
            }),
          )
        }
      }
    }

    const auditDocs = ["docs/audit-agent.md", "docs/integrations-github-ci.md"]
    for (const file of auditDocs) {
      if (!existsSync(path.join(Instance.worktree, file))) {
        findings.push(
          finding({
            id: `documentation.missing.${file.replace(/[/.]/g, "_")}`,
            severity: "medium",
            category: "documentation",
            title: "Audit documentation is missing",
            evidence: file,
            impact: "Users may not understand the audit workflow and integration options.",
            fix: `Create ${file} with setup and usage guidance.`,
            owner_hint: "docs owner",
            profile,
            fail_on,
          }),
        )
      }
    }

    const hasRemoteInstructionURL = (config.instructions ?? []).some(
      (item) => item.startsWith("https://") || item.startsWith("http://"),
    )
    const hasInstructionAllowlist =
      (config.instruction_url_allowlist?.length ?? 0) > 0 || Flag.DAX_INSTRUCTION_URL_ALLOWLIST.length > 0
    if (hasRemoteInstructionURL && !hasInstructionAllowlist) {
      findings.push(
        finding({
          id: "policy.instructions.remote_without_allowlist",
          severity: "high",
          category: "policy",
          title: "Remote instruction URLs are configured without allowlist",
          evidence: "config.instructions contains remote URLs",
          impact: "Prompt-instruction supply chain risk is higher than necessary.",
          fix: "Set instruction_url_allowlist in config (or DAX_INSTRUCTION_URL_ALLOWLIST).",
          owner_hint: "security/policy owner",
          profile,
          fail_on,
        }),
      )
    }

    const constraints = await PM.list_constraints({
      project_id: Instance.project.id,
      limit: 1,
    }).catch(() => [])
    if ((constraints?.length ?? 0) === 0) {
      findings.push(
        finding({
          id: "policy.pm.rules.empty",
          severity: "medium",
          category: "policy",
          title: "No PM guardrail rules are defined",
          evidence: "pm_constraints is empty",
          impact: "Risky operations may rely on ad-hoc approvals only.",
          fix: "Add baseline rules via `/pm rules add ...` for your release workflow.",
          owner_hint: "tech lead",
          profile,
          fail_on,
        }),
      )
    }

    const workflowExists = existsSync(path.join(Instance.worktree, ".github", "workflows"))
    if (!workflowExists) {
      findings.push(
        finding({
          id: "integration.github.workflows.missing",
          severity: "low",
          category: "integration",
          title: "No GitHub workflows directory found",
          evidence: ".github/workflows",
          impact: "CI-based audit automation may not be available.",
          fix: "Add workflow files or disable GitHub integration expectations.",
          owner_hint: "devops",
          profile,
          fail_on,
        }),
      )
    }

    const gitStatus = await $`git status --porcelain`.text().catch(() => "")
    if (gitStatus.trim().length > 0 && trigger === "before_release") {
      findings.push(
        finding({
          id: "release.git.working-tree-dirty",
          severity: "high",
          category: "release",
          title: "Working tree has uncommitted changes before release",
          evidence: gitStatus
            .trim()
            .split("\n")
            .slice(0, 8)
            .join("; "),
          impact: "Release reproducibility and traceability are reduced.",
          fix: "Commit/stash/clean local changes before publish.",
          owner_hint: "release engineering",
          profile,
          fail_on,
        }),
      )
    }

    const blocker_count = findings.filter((item) => item.blocking).length
    const warning_count = findings.filter((item) => !item.blocking && item.severity !== "info").length
    const info_count = findings.filter((item) => item.severity === "info").length
    const status: Status = blocker_count > 0 ? "fail" : warning_count > 0 ? "warn" : "pass"
    const next_actions = [
      ...findings.filter((item) => item.blocking).slice(0, 3).map((item) => `Resolve blocker: ${item.title}`),
      ...(blocker_count === 0 && warning_count > 0 ? ["Resolve warnings before next release cut."] : []),
      ...(findings.length === 0 ? ["No issues found. Keep release verification in CI."] : []),
    ]

    const result: Result = {
      run_id: `audit_${Date.now().toString(36)}`,
      timestamp: new Date().toISOString(),
      profile,
      status,
      findings,
      summary: { blocker_count, warning_count, info_count },
      next_actions,
      metadata: {
        trigger,
        project_id: Instance.project.id,
        github_enabled: settings.github_enabled,
        auto_triggers: settings.auto_triggers,
      },
    }

    await PM.append_event({
      project_id: Instance.project.id,
      event_type: "audit",
      payload: {
        run_id: result.run_id,
        profile: result.profile,
        status: result.status,
        blockers: result.summary.blocker_count,
        warnings: result.summary.warning_count,
        trigger,
      },
    }).catch(() => {})

    return result
  }

  export function gate(result: Result) {
    const blockers = result.findings.filter((item) => item.blocking)
    return {
      pass: blockers.length === 0,
      blockers,
      message:
        blockers.length === 0
          ? "AUDIT_GATE_PASS: no blocking findings."
          : `AUDIT_GATE_FAIL: ${blockers.length} blocking finding(s).`,
    }
  }

  export function explain(result: Result, findingID: string) {
    return result.findings.find((item) => item.id === findingID)
  }

  export function toMarkdown(result: Result) {
    const lines = [
      `## Audit Result`,
      `- run_id: ${result.run_id}`,
      `- profile: ${result.profile}`,
      `- trigger: ${result.metadata.trigger}`,
      `- status: ${result.status}`,
      `- blockers: ${result.summary.blocker_count}`,
      `- warnings: ${result.summary.warning_count}`,
      `- info: ${result.summary.info_count}`,
      "",
    ]

    if (result.findings.length === 0) {
      lines.push("No findings. Release posture is healthy.")
    } else {
      lines.push("### Findings")
      for (const item of result.findings) {
        lines.push(
          `- [${item.blocking ? "BLOCKER" : item.severity.toUpperCase()}] ${item.id}: ${item.title} (${item.category})`,
        )
      }
    }

    if (result.next_actions.length > 0) {
      lines.push("", "### Next Actions")
      result.next_actions.forEach((action, index) => lines.push(`${index + 1}. ${action}`))
    }

    return lines.join("\n")
  }
}
