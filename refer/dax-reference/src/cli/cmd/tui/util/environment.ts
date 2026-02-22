import fs from "fs"
import path from "path"

export type PythonEnvReport = {
  cwd: string
  inVirtualEnv: boolean
  virtualEnvType: "venv" | "conda" | "pyenv" | "none"
  virtualEnvPath?: string
  projectHasPythonSignals: boolean
  projectVenvPaths: string[]
  packageManagerHints: string[]
  recommendation: string
}

export type PythonInstallAnalysis =
  | {
      kind: "missing-venv"
      command: string
      recommendation: string
      reason: string
    }
  | {
      kind: "explicit-global"
      command: string
      reason: string
    }
  | {
      kind: "venv-ok"
      command: string
    }

export type PackageInstallAnalysis =
  | {
      kind: "global-install"
      ecosystem: "node" | "rust"
      command: string
      reason: string
      suggestion?: string
    }
  | {
      kind: "local-ok"
      ecosystem: "node" | "rust"
      command: string
    }

function exists(filepath: string) {
  try {
    return fs.existsSync(filepath)
  } catch {
    return false
  }
}

function detectPreferredManager(cwd: string) {
  const hints: string[] = []
  if (exists(path.join(cwd, "uv.lock"))) hints.push("uv")
  if (exists(path.join(cwd, "poetry.lock"))) hints.push("poetry")
  if (exists(path.join(cwd, "Pipfile"))) hints.push("pipenv")
  if (exists(path.join(cwd, "requirements.txt"))) hints.push("pip")
  if (exists(path.join(cwd, "pyproject.toml"))) {
    if (!hints.includes("uv") && !hints.includes("poetry")) hints.push("pyproject")
  }
  return hints
}

export function detectPythonEnvironment(cwd: string = process.cwd()): PythonEnvReport {
  const activeVenv = process.env["VIRTUAL_ENV"]
  const activeConda = process.env["CONDA_PREFIX"]
  const activePyenv = process.env["PYENV_VERSION"]

  const virtualEnvType: PythonEnvReport["virtualEnvType"] = activeVenv
    ? "venv"
    : activeConda
      ? "conda"
      : activePyenv
        ? "pyenv"
        : "none"

  const inVirtualEnv = virtualEnvType !== "none"
  const virtualEnvPath = activeVenv ?? activeConda ?? undefined

  const projectVenvPaths = [".venv", "venv", "env"]
    .map((item) => path.join(cwd, item))
    .filter((item) => exists(item))

  const packageManagerHints = detectPreferredManager(cwd)
  const projectHasPythonSignals =
    packageManagerHints.length > 0 ||
    exists(path.join(cwd, "setup.py")) ||
    exists(path.join(cwd, "setup.cfg")) ||
    projectVenvPaths.length > 0

  const recommendation = (() => {
    if (inVirtualEnv) {
      return `Active ${virtualEnvType} environment detected. Use project-local installs in this environment.`
    }
    if (projectVenvPaths.length > 0) {
      const rel = path.basename(projectVenvPaths[0]!)
      const activate = process.platform === "win32" ? `${rel}\\Scripts\\activate` : `source ${rel}/bin/activate`
      return `Project venv found (${rel}) but not active. Activate it first: ${activate}`
    }
    if (projectHasPythonSignals) {
      const activate = process.platform === "win32" ? ".venv\\Scripts\\activate" : "source .venv/bin/activate"
      return `No active venv. Recommended: python -m venv .venv && ${activate}`
    }
    return "No Python project signals found. Global install may be acceptable if intentional."
  })()

  return {
    cwd,
    inVirtualEnv,
    virtualEnvType,
    virtualEnvPath,
    projectHasPythonSignals,
    projectVenvPaths,
    packageManagerHints,
    recommendation,
  }
}

export function analyzePythonInstallCommand(
  command: string,
  cwd: string = process.cwd(),
): PythonInstallAnalysis | undefined {
  const normalized = command.trim().toLowerCase()
  const installPattern =
    /\bpip\s+install\b|\bpython(?:3)?\s+-m\s+pip\s+install\b|\buv\s+pip\s+install\b|\buv\s+add\b|\bpoetry\s+add\b/
  if (!installPattern.test(normalized)) return

  const report = detectPythonEnvironment(cwd)
  const explicitGlobal = /\s--user\b|\bpipx\s+install\b|\bsudo\s+pip\b/.test(normalized)

  if (explicitGlobal) {
    return {
      kind: "explicit-global",
      command,
      reason: "This command appears to target a global/user Python install.",
    }
  }

  if (!report.inVirtualEnv && report.projectHasPythonSignals) {
    return {
      kind: "missing-venv",
      command,
      reason: "No active virtual environment detected for a Python package install.",
      recommendation: report.recommendation,
    }
  }

  return {
    kind: "venv-ok",
    command,
  }
}

export function analyzePackageInstallCommand(
  command: string,
  cwd: string = process.cwd(),
): PackageInstallAnalysis | undefined {
  const normalized = command.trim().toLowerCase()
  const isNodeProject = exists(path.join(cwd, "package.json"))
  const nodeGlobal =
    /\bnpm\s+(?:install|i)\s+.+\s-g\b|\bnpm\s+(?:install|i)\s+-g\b|\bpnpm\s+(?:add|install)\s+.+\s-g\b|\bpnpm\s+(?:add|install)\s+-g\b|\byarn\s+global\s+add\b|\bbun\s+add\s+-g\b/.test(
      normalized,
    )
  const nodeLocal =
    /\bnpm\s+(?:install|i)\b|\bpnpm\s+(?:add|install)\b|\byarn\s+add\b|\bbun\s+add\b/.test(normalized)

  if (nodeGlobal) {
    return {
      kind: "global-install",
      ecosystem: "node",
      command,
      reason: "This command installs a Node package globally.",
      suggestion: isNodeProject
        ? "Use project-local install (npm/pnpm/yarn/bun add without -g) when working inside a repo."
        : "Use global install only for intentional machine-wide CLI tools.",
    }
  }
  if (nodeLocal && isNodeProject) {
    return {
      kind: "local-ok",
      ecosystem: "node",
      command,
    }
  }

  const isRustProject = exists(path.join(cwd, "Cargo.toml"))
  const cargoInstall = /\bcargo\s+install\b/.test(normalized)
  const cargoAdd = /\bcargo\s+add\b/.test(normalized)
  const cargoLocalPath = /\bcargo\s+install\b.*\s--path\s+/.test(normalized)

  if (cargoInstall && !cargoLocalPath) {
    return {
      kind: "global-install",
      ecosystem: "rust",
      command,
      reason: "cargo install places binaries in a global cargo bin location.",
      suggestion: isRustProject
        ? "For project deps, prefer cargo add; use cargo install only for intentional global CLIs."
        : "Use cargo install only when you want a machine-wide Rust CLI.",
    }
  }
  if (cargoAdd || cargoLocalPath) {
    return {
      kind: "local-ok",
      ecosystem: "rust",
      command,
    }
  }

  return
}

export function formatEnvironmentDoctorReport(report: PythonEnvReport) {
  const hasNodeProject = exists(path.join(report.cwd, "package.json"))
  const hasRustProject = exists(path.join(report.cwd, "Cargo.toml"))
  const hasNodeLock =
    exists(path.join(report.cwd, "pnpm-lock.yaml")) ||
    exists(path.join(report.cwd, "package-lock.json")) ||
    exists(path.join(report.cwd, "yarn.lock")) ||
    exists(path.join(report.cwd, "bun.lock")) ||
    exists(path.join(report.cwd, "bun.lockb"))
  const nodePolicy = hasNodeProject
    ? "Project detected: prefer local deps (npm/pnpm/yarn/bun add without -g)."
    : "No project detected: use global install only for intentional CLI tools."
  const rustPolicy = hasRustProject
    ? "Rust project detected: prefer cargo add for dependencies; cargo install for CLIs."
    : "No Rust project detected: cargo install is global CLI scope."
  const scope = report.inVirtualEnv ? "isolated (venv/conda/pyenv)" : "global shell"
  const hints = report.packageManagerHints.length > 0 ? report.packageManagerHints.join(", ") : "none detected"
  const venvs = report.projectVenvPaths.length > 0 ? report.projectVenvPaths.map((p) => path.basename(p)).join(", ") : "none"

  return [
    "Python",
    `Scope: ${scope}`,
    `Active env: ${report.virtualEnvType}${report.virtualEnvPath ? ` (${report.virtualEnvPath})` : ""}`,
    `Project venvs: ${venvs}`,
    `Package manager hints: ${hints}`,
    "",
    `Recommendation: ${report.recommendation}`,
    "",
    "Node",
    `Project signals: ${hasNodeProject ? "package.json" : "none"}${hasNodeLock ? " + lockfile" : ""}`,
    `Policy: ${nodePolicy}`,
    "",
    "Rust",
    `Project signals: ${hasRustProject ? "Cargo.toml" : "none"}`,
    `Policy: ${rustPolicy}`,
  ].join("\n")
}
