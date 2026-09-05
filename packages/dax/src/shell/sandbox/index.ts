import { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import type { SandboxProvider, SandboxProviderImpl, SandboxResult, SandboxCapability } from "./types"
import { BubblewrapSandbox } from "./bwrap"
import { SeatbeltSandbox, createSeatbelt } from "./seatbelt"
import { WslSandbox, createWsl } from "./wsl"
import { LandlockSandbox, createLandlock } from "./landlock"

const log = Log.create({ service: "sandbox" })

const PROVIDERS: Record<string, SandboxProviderImpl> = {}

function getProviders(): SandboxProviderImpl[] {
  const platform = process.platform

  if (!PROVIDERS["bwrap"]) {
    PROVIDERS["bwrap"] = new BubblewrapSandbox()
  }
  if (!PROVIDERS["seatbelt"]) {
    PROVIDERS["seatbelt"] = createSeatbelt()
  }
  if (!PROVIDERS["landlock"]) {
    PROVIDERS["landlock"] = createLandlock()
  }
  if (!PROVIDERS["wsl"]) {
    PROVIDERS["wsl"] = createWsl()
  }

  if (platform === "linux") {
    return [PROVIDERS["bwrap"], PROVIDERS["landlock"]]
  }
  if (platform === "darwin") {
    return [PROVIDERS["seatbelt"]]
  }
  if (platform === "win32") {
    return [PROVIDERS["wsl"]]
  }

  return []
}

function getProviderName(provider: SandboxProviderImpl): string {
  const platform = process.platform
  if (platform === "linux") return "bwrap"
  if (platform === "darwin") return "seatbelt"
  if (platform === "win32") return "wsl"
  return "none"
}

export namespace Sandbox {
  const state = {
    initialized: false,
    selectedProvider: null as SandboxProviderImpl | null,
    providerName: "none" as SandboxProvider,
    fallbackProvider: null as SandboxProviderImpl | null,
    capability: null as SandboxCapability | null,
  }

  export const buildDockerCommand = (command: string, cwd: string, image: string): string[] => {
    return ["docker", "run", "--rm", "-v", `${cwd}:/workspace:rw`, "-w", "/workspace", image, "sh", "-c", command]
  }

  export async function init(): Promise<void> {
    if (state.initialized) return

    const cfg = await Config.get()
    const enabled = Flag.DAX_SHELL_SANDBOX_ENABLED || cfg.sandbox?.enabled

    if (!enabled) {
      log.info("sandbox disabled")
      state.initialized = true
      return
    }

    const providers = getProviders()
    const preferred = cfg.sandbox?.provider || "auto"

    let selected: SandboxProviderImpl | null = null

    const p = preferred as string
    if (p !== "auto" && p !== "none" && p !== "docker") {
      selected = providers.find((prov) => prov.name === p) || null
    }

    if (!selected) {
      for (const provider of providers) {
        const check = await provider.check()
        if (check.available) {
          selected = provider
          break
        }
      }
    }

    if (selected) {
      state.selectedProvider = selected
      state.providerName = getProviderName(selected) as SandboxProvider
      state.capability = selected.capabilities
      log.info("sandbox enabled", { provider: state.providerName })
    } else {
      const dockerCheck = await checkDocker()
      if (dockerCheck.available) {
        state.fallbackProvider = new DockerSandbox(dockerCheck.image)
        log.warn("sandbox: native providers not available, falling back to docker", {
          reason: "no native provider available",
        })
      } else {
        log.warn("sandbox: no provider available, running without sandbox", {
          reason: "no native provider or docker available",
        })
      }
    }

    state.initialized = true
  }

  export async function isEnabled(): Promise<boolean> {
    await init()
    return state.selectedProvider !== null || state.fallbackProvider !== null
  }

  export async function isAvailable(): Promise<boolean> {
    await init()
    return state.selectedProvider !== null || state.fallbackProvider !== null
  }

  export async function getCapability(): Promise<SandboxCapability | null> {
    await init()
    return state.capability || null
  }

  export async function getProvider(): Promise<SandboxProvider> {
    await init()
    return state.providerName
  }

  export async function check(): Promise<{ available: boolean; provider?: string; reason?: string }> {
    await init()

    if (state.selectedProvider) {
      return { available: true, provider: state.providerName }
    }

    if (state.fallbackProvider) {
      return { available: true, provider: "docker" }
    }

    const providers = getProviders()
    for (const provider of providers) {
      const check = await provider.check()
      if (check.available) {
        return { available: true, provider: provider.name }
      }
    }

    const dockerCheck = await checkDocker()
    if (dockerCheck.available) {
      return { available: true, provider: "docker" }
    }

    return { available: false, reason: "no sandbox provider available" }
  }

  /**
   * Full argv for a sandboxed run, or null when no provider is active and the
   * caller should run the command itself. Never a shell string: the argv is
   * spawned directly so neither the command nor the working directory is
   * re-parsed by an outer shell.
   */
  export async function wrap(command: string, cwd: string): Promise<string[] | null> {
    await init()

    if (state.selectedProvider) {
      return state.selectedProvider.wrap(command, cwd)
    }

    if (state.fallbackProvider) {
      return state.fallbackProvider.wrap(command, cwd)
    }

    return null
  }

  export async function wrapAsync(command: string, cwd: string): Promise<string[] | null> {
    return wrap(command, cwd)
  }
}

async function checkDocker(): Promise<{ available: boolean; image?: string }> {
  try {
    const dockerCheck = await Bun.spawn(["docker", "info"]).exited
    if (dockerCheck !== 0) {
      return { available: false }
    }
    const image = Flag.DAX_SHELL_SANDBOX_IMAGE || "node:latest"
    return { available: true, image }
  } catch {
    return { available: false }
  }
}

class DockerSandbox implements SandboxProviderImpl {
  readonly name = "docker"
  readonly platform = process.platform as "linux" | "darwin" | "win32"

  readonly capabilities: SandboxCapability = {
    filesystem: "strict",
    network: "none",
    process: "isolated",
  }

  private image: string

  constructor(image: string = "node:latest") {
    this.image = image
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = await Bun.spawn(["docker", "info"]).exited
      return result === 0
    } catch {
      return false
    }
  }

  async check(): Promise<{ available: boolean; reason?: string }> {
    const available = await this.isAvailable()
    if (!available) {
      return { available: false, reason: "Docker not available. Install Docker Desktop." }
    }
    return { available: true }
  }

  async wrap(command: string, cwd: string): Promise<string[]> {
    return Sandbox.buildDockerCommand(command, cwd, this.image)
  }
}
