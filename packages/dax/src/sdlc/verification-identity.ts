import { createCapabilityRegistry } from "@/capability/registry"
import type { CapabilityDescriptor } from "@/capability/capability-types"
import { CapabilityIdentityError } from "@/capability/dynamic-identity"
import type { CheckDefinition } from "./check-types"
import fs from "node:fs"
import path from "node:path"
import { executableFacts, type ExecutableFacts } from "@/capability/implementation-binding"

// A verification command is DAX-dispatched from the contract's validation plan.
// These describe the two runners; they do not decide which checks a run requires
// and they say nothing about whether a check passed.
const registry = createCapabilityRegistry([
  { id: "verification.command.direct", riskClass: "high", scopeSupport: "opaque", requiresVerification: false },
  { id: "verification.command.sandboxed", riskClass: "high", scopeSupport: "opaque", requiresVerification: false },
])

export type VerificationRunner = "direct" | "sandboxed"
type Snapshot = {
  runner: VerificationRunner
  check: CheckDefinition
  command: string
  args: readonly string[]
  cwd: string
  timeoutMs: number
  executor: object
}

const bindings = new WeakMap<object, Snapshot>()
export type VerificationCommandBinding = object

/** Capture the planned check and the genuine runner before any lookup or setup. */
export function bindVerificationCommand(input: {
  runner: VerificationRunner
  check: CheckDefinition
  executor: object
}): VerificationCommandBinding {
  const { check } = input
  if (
    !check ||
    typeof check.command !== "string" ||
    !check.command ||
    !Array.isArray(check.args) ||
    check.args.some((arg) => typeof arg !== "string") ||
    typeof check.cwd !== "string" ||
    typeof input.executor !== "function"
  )
    throw new CapabilityIdentityError("malformed")
  registry.require(`verification.command.${input.runner}`)
  const binding = Object.freeze({})
  bindings.set(binding, {
    runner: input.runner,
    check,
    command: check.command,
    args: Object.freeze([...check.args]),
    cwd: check.cwd,
    timeoutMs: check.timeoutMs,
    executor: input.executor,
  })
  return binding
}

/** Recheck immediately before the process effect: same check, same argv, same runner. */
export function requireVerificationCommandCapability(input: {
  binding: VerificationCommandBinding
  runner: VerificationRunner
  check: CheckDefinition
  executor: object
}): CapabilityDescriptor {
  const snapshot = bindings.get(input.binding)
  if (!snapshot) throw new CapabilityIdentityError("unbound")
  if (
    snapshot.runner !== input.runner ||
    snapshot.check !== input.check ||
    snapshot.executor !== input.executor ||
    snapshot.command !== input.check.command ||
    snapshot.cwd !== input.check.cwd ||
    snapshot.timeoutMs !== input.check.timeoutMs ||
    snapshot.args.length !== input.check.args.length ||
    snapshot.args.some((arg, index) => arg !== input.check.args[index])
  )
    throw new CapabilityIdentityError("changed")
  return registry.require(`verification.command.${snapshot.runner}`)
}

// The genuine dispatch functions, each registered once by the module that owns
// it. Which runner dispatched a check is established by the function that
// actually holds the binding, never by the runner name it passed.
const genuineRunners = new Map<object, VerificationRunner>()

export function registerVerificationRunner(runner: VerificationRunner, executor: object) {
  const existing = genuineRunners.get(executor)
  if (existing !== undefined && existing !== runner) throw new CapabilityIdentityError("ambiguous")
  if ([...genuineRunners].some(([other, name]) => name === runner && other !== executor)) {
    throw new CapabilityIdentityError("ambiguous")
  }
  genuineRunners.set(executor, runner)
}

export type VerificationDispatch = {
  runner: VerificationRunner
  argv: readonly string[]
  /** Working directory relative to the worktree, with forward slashes. */
  cwd: string
  executable: ExecutableFacts
}

/**
 * What is about to run for a bound check, as a reviewed verification grant
 * describes it: the runner the genuine dispatch function establishes, the
 * argument vector, the working directory relative to the worktree, and the
 * executable by content. Undefined when the binding is not held by a genuine
 * runner, or the directory is outside the worktree.
 */
export function describeVerificationDispatch(
  binding: VerificationCommandBinding,
  worktree: string,
): VerificationDispatch | undefined {
  const snapshot = bindings.get(binding)
  if (!snapshot) return undefined
  const runner = genuineRunners.get(snapshot.executor)
  if (runner === undefined || runner !== snapshot.runner) return undefined
  let cwd: string
  try {
    const root = fs.realpathSync(worktree)
    const target = fs.realpathSync(path.resolve(root, snapshot.cwd))
    const relative = path.relative(root, target)
    if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined
    cwd = relative === "" ? "." : relative.split(path.sep).join("/")
  } catch {
    return undefined
  }
  return {
    runner,
    argv: [snapshot.command, ...snapshot.args],
    cwd,
    executable: executableFacts(snapshot.command, { cwd: path.resolve(worktree, snapshot.cwd) }),
  }
}

export function listVerificationCommandCapabilities(): readonly CapabilityDescriptor[] {
  return registry.list()
}
