import { $ } from "bun"
import type { SandboxProviderImpl, SandboxCapability } from "./types"

function which(cmd: string): string | null {
  return Bun.which(cmd)
}

export class BubblewrapSandbox implements SandboxProviderImpl {
  readonly name = "bwrap"
  readonly platform = process.platform as "linux" | "darwin" | "win32"

  readonly capabilities: SandboxCapability = {
    filesystem: "strict",
    network: "none",
    process: "isolated",
    resources: {
      maxProcesses: 64,
    },
  }

  async isAvailable(): Promise<boolean> {
    const bwrapPath = which("bwrap")
    return bwrapPath !== null
  }

  async check(): Promise<{ available: boolean; reason?: string }> {
    const bwrapPath = which("bwrap")
    if (!bwrapPath) {
      return {
        available: false,
        reason: "bwrap not found. Install with: apt install bwrap (Debian/Ubuntu) or dnf install bwrap (Fedora)",
      }
    }

    const testResult = await $`bwrap --version`.nothrow().text()
    if (!testResult) {
      return { available: false, reason: "bwrap exists but failed to execute" }
    }

    return { available: true }
  }

  async wrap(command: string, cwd: string): Promise<string[]> {
    const bindDir = cwd

    return [
      "bwrap",
      "--unshare-all",
      "--new-session",
      "--die-with-parent",
      "--chdir",
      bindDir,
      "--ro-bind",
      "/usr",
      "/usr",
      "--ro-bind",
      "/bin",
      "/bin",
      "--ro-bind",
      "/lib",
      "/lib",
      "--ro-bind",
      "/lib64",
      "/lib64",
      "--ro-bind",
      "/etc",
      "/etc",
      "--ro-bind",
      "/usr/share",
      "/usr/share",
      "--tmpfs",
      "/tmp",
      "--tmpfs",
      "/run",
      "--dev",
      "/dev",
      "--bind",
      `${bindDir}`,
      "/workspace",
      "-w",
      "/workspace",
      "/bin/sh",
      "-c",
      command,
    ]
  }
}
