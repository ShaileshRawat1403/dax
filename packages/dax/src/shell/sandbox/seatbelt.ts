import { $ } from "bun"
import type { SandboxProviderImpl, SandboxCapability } from "./types"

const DEFAULT_SEATBELT_PROFILE = `(version 1)
(deny default)
; Standard OS runtime support (dyld, system libraries, inherited descriptors)
(import "system.sb")
(allow file-read* (literal "/private/var/select/sh"))
(allow file-read* (subpath "/bin"))
(allow process-info*)
(allow signal (target self))
(allow job-creation)

; Filesystem - project directory only
(allow file-read* (subpath "/Users"))
(allow file-write* (subpath "/Users"))
(allow file-read* (subpath "/private/var/folders"))
(allow file-write* (subpath "/private/var/folders"))
(allow file-read* (subpath "/tmp"))
(allow file-write* (subpath "/tmp"))
(allow file-read* (subpath "/var/folders"))
(allow file-write* (subpath "/var/folders"))

; Binaries
(allow process-exec (literal "/bin/bash"))
(allow process-exec (literal "/bin/zsh"))
(allow process-exec (literal "/bin/sh"))
(allow process-exec (literal "/usr/bin/bash"))
(allow process-exec (literal "/usr/bin/zsh"))
(allow process-exec (literal "/bin/ls"))
(allow process-exec (literal "/bin/cat"))
(allow process-exec (literal "/bin/mkdir"))
(allow process-exec (literal "/bin/touch"))
(allow process-exec (literal "/bin/rm"))
(allow process-exec (literal "/bin/cp"))
(allow process-exec (literal "/bin/mv"))
(allow process-exec (literal "/usr/bin/git"))
(allow process-exec (literal "/usr/bin/npm"))
(allow process-exec (literal "/usr/bin/node"))
(allow process-exec (literal "/usr/local/bin/*"))
(allow process-exec (regex #"^/usr/local/Cellar/.*"))

; Network - deny by default, allow localhost for npm
(deny network*)
(allow network* (remote ip "localhost:*"))
`

const STRICT_SEATBELT_PROFILE = `(version 1)
(deny default)
(allow process-info*)
(allow process-info-pidinfo *)
(allow signal (target self))

; Filesystem - read-only access to system, full to project
(allow file-read* (subpath "/usr"))
(allow file-read* (subpath "/bin"))
(allow file-read* (subpath "/private/etc"))
(allow file-read* (subpath "/Library"))
(allow file-read* (subpath "/System"))
(allow file-read* (subpath "/tmp"))

; Deny all writes except to tmp
(deny file-write*)

; Allow process execution for shell
(allow process-exec (literal "/bin/bash"))
(allow process-exec (literal "/bin/sh"))
(allow process-exec (literal "/bin/zsh"))
(allow process-exec (regex #"^/usr/bin/.*"))
(allow process-exec (regex #"^/usr/local/bin/.*"))
(allow process-exec (regex #"^/opt/homebrew/bin/.*"))

; Network - deny all
(deny network*)
`

export class SeatbeltSandbox implements SandboxProviderImpl {
  readonly name = "seatbelt"
  readonly platform = "darwin" as const

  readonly capabilities: SandboxCapability = {
    filesystem: "strict",
    network: "none",
    process: "isolated",
  }

  private strict: boolean

  constructor(strict: boolean = true) {
    this.strict = strict
  }

  async isAvailable(): Promise<boolean> {
    const seatbeltPath = Bun.which("sandbox-exec")
    return seatbeltPath !== null
  }

  async check(): Promise<{ available: boolean; reason?: string }> {
    const seatbeltPath = Bun.which("sandbox-exec")
    if (!seatbeltPath) {
      return {
        available: false,
        reason: "sandbox-exec not found. This is a macOS system binary - should be available by default.",
      }
    }

    return { available: true }
  }

  async wrap(command: string, _cwd: string): Promise<string[]> {
    const profile = this.strict ? STRICT_SEATBELT_PROFILE : DEFAULT_SEATBELT_PROFILE
    // The working directory is applied by the spawn, not passed as an argument:
    // it used to sit where sandbox-exec expects the program to run, so a
    // correctly formed sandboxed command could not execute at all.
    return ["sandbox-exec", "-p", profile, "/bin/sh", "-c", command]
  }
}

export function createSeatbelt(strict: boolean = true): SeatbeltSandbox {
  return new SeatbeltSandbox(strict)
}
