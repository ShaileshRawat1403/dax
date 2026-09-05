import z from "zod"

export const SandboxCapability = z.object({
  filesystem: z.enum(["none", "read-only", "write", "strict"]).default("none"),
  network: z.enum(["full", "localhost-only", "none"]).default("full"),
  process: z.enum(["none", "isolated"]).default("none"),
  resources: z
    .object({
      cpuLimit: z.number().optional(),
      memoryLimit: z.number().optional(),
      maxProcesses: z.number().optional(),
    })
    .optional(),
})

export type SandboxCapability = z.infer<typeof SandboxCapability>

export const SandboxProvider = z.enum(["none", "docker", "bwrap", "seatbelt", "wsl", "landlock", "auto"])
export type SandboxProvider = z.infer<typeof SandboxProvider>

export const SandboxConfig = z.object({
  enabled: z.boolean().default(false),
  provider: SandboxProvider.default("auto"),
  strict: z.boolean().default(true),
  filesystem: z.enum(["none", "read-only", "write", "strict"]).default("strict"),
  network: z.enum(["full", "localhost-only", "none"]).default("localhost-only"),
  allowNetwork: z.boolean().default(false),
  maxMemory: z.number().optional(),
  maxProcesses: z.number().optional(),
  maxTime: z.number().optional(),
  image: z.string().optional(),
  fallback: z.enum(["none", "docker", "permissive"]).default("docker"),
})
export type SandboxConfig = z.infer<typeof SandboxConfig>

export interface SandboxProviderImpl {
  readonly name: string
  readonly platform: "linux" | "darwin" | "win32"
  readonly capabilities: SandboxCapability

  isAvailable(): Promise<boolean>
  check(): Promise<{ available: boolean; reason?: string }>
  /**
   * Returns the full argv to spawn. It must never be joined into a shell
   * string: every provider embeds the caller's command, and the working
   * directory is model-controlled, so a joined string is re-parsed by the
   * outer shell and the sandbox becomes the injection sink it exists to
   * prevent. The command travels as one argv element.
   */
  wrap(command: string, cwd: string): Promise<string[]>
}

export interface SandboxResult {
  wrapped: boolean
  provider: SandboxProvider
  command: string[]
  capability: SandboxCapability
}
