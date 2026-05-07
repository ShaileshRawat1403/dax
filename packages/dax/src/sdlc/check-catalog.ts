import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import type { CheckDefinition } from "./check-types"

function has(repoRoot: string, file: string) {
  return existsSync(path.join(repoRoot, file))
}

function hasAny(repoRoot: string, files: string[]) {
  return files.some((file) => has(repoRoot, file))
}

function packageScripts(repoRoot: string): Record<string, string> {
  const packagePath = path.join(repoRoot, "package.json")
  if (!existsSync(packagePath)) return {}

  try {
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { scripts?: Record<string, string> }
    return parsed.scripts ?? {}
  } catch {
    return {}
  }
}

function hasScript(repoRoot: string, script: string) {
  return Object.prototype.hasOwnProperty.call(packageScripts(repoRoot), script)
}

export function detectGenericChecks(repoRoot: string): CheckDefinition[] {
  const checks: CheckDefinition[] = []

  if (has(repoRoot, "package.json")) {
    if (hasScript(repoRoot, "typecheck")) {
      checks.push({
        id: "js-typecheck",
        kind: "typecheck",
        label: "TypeScript typecheck",
        command: "bun",
        args: ["run", "typecheck"],
        cwd: repoRoot,
        required: true,
        timeoutMs: 180_000,
        risk: "medium",
      })
    }

    if (hasScript(repoRoot, "test")) {
      checks.push({
        id: "js-test",
        kind: "test",
        label: "JavaScript or TypeScript tests",
        command: "bun",
        args: ["run", "test"],
        cwd: repoRoot,
        required: true,
        timeoutMs: 240_000,
        risk: "medium",
      })
    }

    if (hasScript(repoRoot, "build")) {
      checks.push({
        id: "js-build",
        kind: "build",
        label: "JavaScript or TypeScript build",
        command: "bun",
        args: ["run", "build"],
        cwd: repoRoot,
        required: false,
        timeoutMs: 300_000,
        risk: "medium",
      })
    }
  }

  if (has(repoRoot, "Cargo.toml")) {
    checks.push(
      {
        id: "rust-fmt",
        kind: "format",
        label: "Rust format check",
        command: "cargo",
        args: ["fmt", "--all", "--", "--check"],
        cwd: repoRoot,
        required: true,
        timeoutMs: 120_000,
        risk: "low",
      },
      {
        id: "rust-clippy",
        kind: "lint",
        label: "Rust clippy",
        command: "cargo",
        args: ["clippy", "--workspace", "--all-targets", "--", "-D", "warnings"],
        cwd: repoRoot,
        required: true,
        timeoutMs: 240_000,
        risk: "medium",
      },
      {
        id: "rust-test",
        kind: "test",
        label: "Rust tests",
        command: "cargo",
        args: ["test", "--workspace"],
        cwd: repoRoot,
        required: true,
        timeoutMs: 300_000,
        risk: "medium",
      },
    )
  }

  if (hasAny(repoRoot, ["pyproject.toml", "requirements.txt", "setup.py"])) {
    checks.push(
      {
        id: "python-ruff",
        kind: "lint",
        label: "Python ruff",
        command: "ruff",
        args: ["check", "."],
        cwd: repoRoot,
        required: false,
        timeoutMs: 120_000,
        risk: "medium",
      },
      {
        id: "python-pytest",
        kind: "test",
        label: "Python tests",
        command: "pytest",
        args: [],
        cwd: repoRoot,
        required: false,
        timeoutMs: 240_000,
        risk: "medium",
      },
    )
  }

  return checks
}

export function detectDaxNativeChecks(repoRoot: string): CheckDefinition[] {
  const checks: CheckDefinition[] = []

  if (hasScript(repoRoot, "verify:hybrid")) {
    checks.push({
      id: "dax-verify-hybrid",
      kind: "test",
      label: "DAX hybrid verification",
      command: "bun",
      args: ["run", "verify:hybrid"],
      cwd: repoRoot,
      required: true,
      timeoutMs: 420_000,
      risk: "high",
    })
  }

  if (hasScript(repoRoot, "proof:check")) {
    checks.push({
      id: "dax-proof-check",
      kind: "release",
      label: "DAX proof ladder check",
      command: "bun",
      args: ["run", "proof:check"],
      cwd: repoRoot,
      required: false,
      timeoutMs: 480_000,
      risk: "high",
    })
  }

  return checks
}

export function detectSecurityChecks(repoRoot: string): CheckDefinition[] {
  return [
    {
      id: "gitleaks-dir",
      kind: "secrets",
      label: "Gitleaks secrets scan",
      command: "gitleaks",
      args: ["dir", "--redact", repoRoot],
      cwd: repoRoot,
      required: false,
      timeoutMs: 180_000,
      risk: "high",
    },
    {
      id: "trivy-fs",
      kind: "security",
      label: "Trivy filesystem scan",
      command: "trivy",
      args: ["fs", "--scanners", "vuln,secret,misconfig", repoRoot],
      cwd: repoRoot,
      required: false,
      timeoutMs: 300_000,
      risk: "high",
    },
  ]
}

export function detectChecks(repoRoot: string, opts: { native?: boolean; security?: boolean } = {}): CheckDefinition[] {
  const checks = opts.native ? detectDaxNativeChecks(repoRoot) : detectGenericChecks(repoRoot)
  if (opts.security) checks.push(...detectSecurityChecks(repoRoot))
  return checks
}
