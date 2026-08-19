import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { isWhitelistedVerificationCommand } from "@/tool/shell-whitelist"

/**
 * Verification commands a run can fall back to when its contract requires
 * evidence but names none.
 *
 * The problem this solves: `postconditions.validationCommands` was populated by
 * keyword-matching the intent and produced prose — "run relevant tests" — which
 * parses to the executable `run`, fails the verification allowlist, and is
 * rejected. A contract could therefore demand evidence and describe no way to
 * produce any. Requiring proof while making proof impossible is worse than not
 * requiring it, because it fails runs for the wrong reason.
 *
 * Everything returned here is checked against the same allowlist that
 * verification itself applies, so a command that would be rejected downstream is
 * never offered upstream.
 */

type PackageJson = { scripts?: Record<string, string> }

function readPackageJson(root: string): PackageJson | null {
  const path = join(root, "package.json")
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PackageJson
  } catch {
    // A malformed package.json is not this module's problem to report. Returning
    // null degrades to "no defaults detected", which the caller already handles.
    return null
  }
}

/** The package runner this repo actually uses, inferred from its lockfile. */
function detectRunner(root: string): "bun" | "pnpm" | "yarn" | "npm" {
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))) return "bun"
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm"
  if (existsSync(join(root, "yarn.lock"))) return "yarn"
  return "npm"
}

/**
 * Detect the checks this repository can actually run.
 *
 * Ordered by how directly each one speaks to correctness: typecheck before test
 * before lint, so a run that can only afford one check runs the most decisive.
 */
export function deriveDefaultValidationCommands(root: string): string[] {
  const commands: string[] = []

  const pkg = readPackageJson(root)
  if (pkg?.scripts) {
    const runner = detectRunner(root)
    for (const script of ["typecheck", "test", "lint"]) {
      if (pkg.scripts[script]) commands.push(`${runner} run ${script}`)
    }
  }

  if (existsSync(join(root, "Cargo.toml"))) {
    commands.push("cargo check")
    commands.push("cargo test")
  }

  if (existsSync(join(root, "pyproject.toml")) || existsSync(join(root, "pytest.ini"))) {
    commands.push("pytest")
  }

  // Never hand downstream a command its own allowlist would refuse.
  return commands.filter((command) => isWhitelistedVerificationCommand(command))
}
