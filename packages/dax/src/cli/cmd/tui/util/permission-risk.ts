/**
 * Shared risk classification for permission requests.
 *
 * This module is the single source of truth for how DAX labels a pending
 * permission request as normal / privacy-sensitive / critical.  Both the
 * inline PermissionPrompt (permission.tsx) and the RAO right-pane
 * (rao-pane.tsx) import from here so that the rules cannot silently drift
 * between the two surfaces.
 *
 * Upgrade checklist when adding new checks:
 *  1. Add the rule here.
 *  2. Add a comment explaining what the rule catches and why the risk level
 *     was chosen.
 *  3. The change is automatically reflected in every surface on next build.
 */

import type { PermissionRequest } from "@dax-ai/sdk/v2"
import type { PolicyProfile } from "@/dax/approval"
import { analyzePackageInstallCommand, analyzePythonInstallCommand } from "./environment"

export type PermissionRiskLevel = "normal" | "privacy" | "critical"

export interface PermissionRisk {
  level: PermissionRiskLevel
  reason: string
  suggestion?: string
}

// ── File-path patterns that indicate sensitive content ────────────────────────
//
// Matches:
//   .env  .env.local  .env.production  (environment variable files)
//   .ssh/  id_rsa  id_ed25519         (SSH private keys)
//   credentials  token  secret        (generic credential names)
//   .npmrc  .aws                      (tool-specific credential stores)
//
const SENSITIVE_PATH_RE =
  /(^|\/)\.env($|\.)|(^|\/)\.ssh(\/|$)|id_rsa|id_ed25519|credentials|token|secret|\.npmrc|\.aws/i

// ── Shell command patterns ─────────────────────────────────────────────────────
//
// CRITICAL — state-mutating or destructive operations that are hard to undo.
const CRITICAL_SHELL_RE =
  /rm\s+-rf|sudo\s+|chmod\s+|chown\s+|dd\s+if=|mkfs|shutdown|reboot|halt|killall|pkill|git\s+push|git\s+reset\s+--hard|curl.+\|\s*(bash|sh)/

// PRIVACY — commands that read or transmit credentials / private data.
//
// `\benv\b`      — bare `env` lists every environment variable, including
//                  secrets injected by CI/CD, .env loaders, or shell profiles.
// `printenv`     — same as env, explicit form.
// `set\b`        — bash `set` / `set -a` etc. also dumps all variables.
// `export\s+-p`  — prints all exported variables as key=value pairs.
// `cat .env`     — direct read of an env file via shell.
// Other entries  — transmit auth tokens, project data, or credentials outward.
//
const PRIVACY_SHELL_RE =
  /\benv\b|printenv|\bset\b|export\s+-p|cat\s+.*\.env|gh\s+auth|aws\s+|gcloud\s+|scp\s+|rsync\s+/

export function classifyPermissionRisk(
  request: PermissionRequest,
  input: Record<string, unknown>,
  profile: PolicyProfile,
): PermissionRisk {
  const permission = request.permission

  const risk = (level: PermissionRiskLevel, reason: string, suggestion?: string): PermissionRisk => ({
    level,
    reason,
    suggestion,
  })

  // Privacy-sensitive operations are escalated to critical in strict mode.
  const elevatePrivacy = (reason: string, suggestion?: string): PermissionRisk =>
    risk(profile === "strict" ? "critical" : "privacy", reason, suggestion)

  const normal = (): PermissionRisk => risk("normal", "")

  // ── Permission-type checks ──────────────────────────────────────────────────

  if (permission === "external_directory") {
    return elevatePrivacy("Outside-project directory access may expose local private files.")
  }

  if (permission === "webfetch" || permission === "websearch" || permission === "codesearch") {
    return elevatePrivacy("This may send project context or queries to external services.")
  }

  if (permission === "doom_loop") {
    return risk("critical", "Continuing after repeated failures can cause unintended repeated actions.")
  }

  // ── Subagent / task spawning ────────────────────────────────────────────────
  //
  // Spawning a subagent creates a new execution context that can make further
  // tool calls — including reads, writes, and network requests — with its own
  // independent approval scope.  Treat it as privacy-sensitive by default so
  // the operator knows a child agent is being launched.
  if (permission === "task") {
    return elevatePrivacy(
      "A subagent will be spawned and may execute further tool calls on your behalf.",
      "Review the task description and prompt before approving.",
    )
  }

  if (permission === "read") {
    const filePath = String(input.filePath ?? "")
    if (SENSITIVE_PATH_RE.test(filePath)) {
      // Reading .env and credential files is critical, not merely privacy-sensitive.
      // The file almost certainly contains plaintext secrets; DAX should not read
      // it unless the operator explicitly reviews and approves the request.
      return risk("critical", "This file likely contains secrets or credentials — reading it will expose them to the model.")
    }
    return normal()
  }

  if (permission === "edit") {
    const filepath = String(request.metadata?.filepath ?? "")
    if (SENSITIVE_PATH_RE.test(filepath)) {
      return risk("critical", "Editing a sensitive file can impact credentials or security settings.")
    }
    return normal()
  }

  // ── File discovery tools ────────────────────────────────────────────────────
  //
  // glob / grep / list are read-only discovery tools that are normally low-risk.
  // However, if the search pattern or path touches known sensitive locations
  // (credential files, SSH keys, env files) the result leaks file existence or
  // content to the model.
  if (permission === "glob") {
    const pattern = String(input.pattern ?? "")
    if (SENSITIVE_PATH_RE.test(pattern)) {
      return elevatePrivacy("This glob pattern may match credential or secret files.")
    }
    return normal()
  }

  if (permission === "grep") {
    // grep path/glob argument
    const path = String(input.path ?? input.glob ?? "")
    if (SENSITIVE_PATH_RE.test(path)) {
      return elevatePrivacy("Grep is targeting a path that may contain secrets or credentials.")
    }
    return normal()
  }

  if (permission === "list") {
    const searchPath = String(input.path ?? "")
    if (SENSITIVE_PATH_RE.test(searchPath)) {
      return elevatePrivacy("Listing this directory may reveal the presence of credential files.")
    }
    return normal()
  }

  // ── LSP / language server ────────────────────────────────────────────────────
  //
  // LSP reads indexed symbol data from source files.  Normally low-risk, but
  // flag it as normal so it appears in the review queue without elevation.
  if (permission === "lsp") {
    return normal()
  }

  if (permission === "shell") {
    const command = String(input.command ?? "").toLowerCase()

    // Python environment checks
    const pythonInstall = analyzePythonInstallCommand(command)
    if (pythonInstall?.kind === "missing-venv") {
      return risk("critical", pythonInstall.reason, pythonInstall.recommendation)
    }
    if (pythonInstall?.kind === "explicit-global") {
      return elevatePrivacy(pythonInstall.reason)
    }

    // Package install checks
    const packageInstall = analyzePackageInstallCommand(command)
    if (packageInstall?.kind === "global-install") {
      return elevatePrivacy(packageInstall.reason, packageInstall.suggestion)
    }

    if (CRITICAL_SHELL_RE.test(command)) {
      return risk("critical", "This command can change system state or perform destructive operations.")
    }

    if (PRIVACY_SHELL_RE.test(command)) {
      return elevatePrivacy(
        "This command may read or transmit environment variables, credentials, or private data.",
        "Review the full command output before approving. Secrets printed here are sent to the model.",
      )
    }

    return normal()
  }

  return normal()
}
