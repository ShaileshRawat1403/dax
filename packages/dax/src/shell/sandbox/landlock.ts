import { $ } from "bun"
import type { SandboxProviderImpl, SandboxCapability } from "./types"

const LANDLOCK_MIN_VERSION = "0.9"
const LANDLOCK_SUPPORTED_FS = 5

export class LandlockSandbox implements SandboxProviderImpl {
  readonly name = "landlock"
  readonly platform = process.platform as "linux" | "darwin" | "win32"

  readonly capabilities: SandboxCapability = {
    filesystem: "strict",
    network: "none",
    process: "none",
  }

  private allowedPaths: string[] = []
  private deniedPaths: string[] = []

  async isAvailable(): Promise<boolean> {
    return await this.check().then((r) => r.available)
  }

  async check(): Promise<{ available: boolean; reason?: string }> {
    if (process.platform !== "linux") {
      return {
        available: false,
        reason: "Landlock is only available on Linux kernels 5.13+",
      }
    }

    try {
      const version = await $`landlock --version 2>/dev/null || echo "not-installed"`.nothrow().text()
      if (!version.trim() || version.includes("not-installed")) {
        return {
          available: false,
          reason: "landlock binary not found. Install from: https://github.com/landlock-sm/landlock or use bwrap",
        }
      }

      const kernelVersion = await $`uname -r`.text()
      const major = parseInt(kernelVersion.split(".")[0] || "0")
      if (major < 5) {
        return {
          available: false,
          reason: `Kernel ${kernelVersion} does not support Landlock (requires 5.13+)`,
        }
      }

      const supportCheck = await $`ls /sys/kernel/security/landlock 2>/dev/null`.nothrow().text()
      if (!supportCheck) {
        return {
          available: false,
          reason: "Landlock LSM not enabled in kernel",
        }
      }

      return { available: true }
    } catch {
      return {
        available: false,
        reason: "Unable to check Landlock availability",
      }
    }
  }

  setAllowedPaths(paths: string[]): void {
    this.allowedPaths = paths
  }

  setDeniedPaths(paths: string[]): void {
    this.deniedPaths = paths
  }

  async wrap(command: string, cwd: string): Promise<string> {
    if (!this.allowedPaths.length) {
      this.allowedPaths = [cwd, "/tmp", "/var/tmp"]
    }

    const allowArgs = this.allowedPaths.flatMap((p) => ["--allow-read", p])
    const denyArgs = this.deniedPaths.flatMap((p) => ["--deny", p])
    const quotedCmd = `'${command.replace(/'/g, "'\\''")}'`

    return ["landlock", ...allowArgs, ...denyArgs, "sh", "-c", quotedCmd].join(" ")
  }
}

export function createLandlock(): LandlockSandbox {
  return new LandlockSandbox()
}

export async function checkLandlockSupport(): Promise<{ supported: boolean; version?: string }> {
  if (process.platform !== "linux") {
    return { supported: false }
  }

  try {
    const kernelVersion = await $`uname -r`.text()
    const major = parseInt(kernelVersion.split(".")[0] || "0")
    const minor = parseInt(kernelVersion.split(".")[1] || "0")

    if (major > 5 || (major === 5 && minor >= 13)) {
      const supportCheck = await $`ls /sys/kernel/security/landlock 2>/dev/null`.nothrow().text()
      if (supportCheck) {
        return { supported: true, version: kernelVersion.trim() }
      }
    }

    return { supported: false }
  } catch {
    return { supported: false }
  }
}
