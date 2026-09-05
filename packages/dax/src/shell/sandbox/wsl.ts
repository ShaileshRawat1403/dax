import { $ } from "bun"
import type { SandboxProviderImpl, SandboxCapability } from "./types"

export class WslSandbox implements SandboxProviderImpl {
  readonly name = "wsl"
  readonly platform = "win32" as const

  readonly capabilities: SandboxCapability = {
    filesystem: "strict",
    network: "none",
    process: "isolated",
  }

  private wslDistro: string | null = null
  private useBwrap: boolean = true

  async isAvailable(): Promise<boolean> {
    return await this.check().then((r) => r.available)
  }

  async check(): Promise<{ available: boolean; reason?: string }> {
    try {
      const wslExists = await $`wsl --status`.nothrow().text()
      if (!wslExists.includes("default distribution")) {
        return {
          available: false,
          reason: "WSL2 not installed. Install with: wsl --install (requires Windows Pro/Enterprise)",
        }
      }

      const distros = await $`wsl --list --running`.nothrow().text()
      const hasUbuntu = distros.toLowerCase().includes("ubuntu")
      const hasDebian = distros.toLowerCase().includes("debian")

      if (!hasUbuntu && !hasDebian) {
        return {
          available: false,
          reason: "No WSL2 distribution found. Install Ubuntu or Debian: wsl --install -d Ubuntu",
        }
      }

      const bwrapCheck = await $`wsl -e sh -c "which bwrap"`.nothrow().text()
      if (!bwrapCheck.trim()) {
        return {
          available: false,
          reason: "bwrap not installed in WSL2. Install with: sudo apt install bwrap (in WSL)",
        }
      }

      this.wslDistro = distros.split("\n")[1]?.trim().split(" ")[0] || "Ubuntu"

      return { available: true }
    } catch (error) {
      return {
        available: false,
        reason: `WSL2 check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      }
    }
  }

  async wrap(command: string, cwd: string): Promise<string[]> {
    const distro = this.wslDistro || "Ubuntu"
    const windowsPath = cwd.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/mnt/$1")

    if (this.useBwrap) {
      const bwrapCmd: string[] = [
        "bwrap",
        "--unshare-all",
        "--new-session",
        "--die-with-parent",
        "--chdir",
        windowsPath,
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
        "--tmpfs",
        "/tmp",
        "--bind",
        windowsPath,
        "/workspace",
        "-w",
        "/workspace",
        "/bin/sh",
        "-c",
        command,
      ]

      return ["wsl", "-d", distro, ...bwrapCmd]
    }

    // --cd keeps the working directory out of the command string; it used to be
    // interpolated into "cd <path> && <command>" and re-parsed by the shell.
    return ["wsl", "-d", distro, "--cd", windowsPath, "sh", "-c", command]
  }
}

export function createWsl(): WslSandbox {
  return new WslSandbox()
}

export async function detectWsl(): Promise<{ available: boolean; distro?: string; hasBwrap: boolean }> {
  try {
    const status = await $`wsl --status`.nothrow().text()
    if (!status.includes("default distribution")) {
      return { available: false, hasBwrap: false }
    }

    const distros = await $`wsl --list`.nothrow().text()
    const lines = distros.split("\n").filter((l) => l.trim() && !l.includes("NAME"))
    const defaultDistro = lines[1]?.trim().split(" ")[0]

    if (!defaultDistro) {
      return { available: false, hasBwrap: false }
    }

    const bwrapCheck = await $`wsl -d ${defaultDistro} -e sh -c "which bwrap"`.nothrow().text()
    return {
      available: true,
      distro: defaultDistro,
      hasBwrap: bwrapCheck.trim().length > 0,
    }
  } catch {
    return { available: false, hasBwrap: false }
  }
}
