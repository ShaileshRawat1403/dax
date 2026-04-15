import { Config } from "@/config/config"
import { Flag } from "@/flag/flag"

export namespace Sandbox {
  export async function wrap(command: string, cwd: string): Promise<string> {
    const cfg = await Config.get()
    const enabled = Flag.DAX_SHELL_SANDBOX_ENABLED || cfg.sandbox?.enabled
    if (!enabled) return command

    const provider = cfg.sandbox?.provider ?? "docker"
    if (provider !== "docker") return command

    const image = Flag.DAX_SHELL_SANDBOX_IMAGE ?? cfg.sandbox?.image ?? "node:latest"

    // Single-quote both cwd and command to safely handle spaces and special chars.
    // The '\'' sequence closes the quote, emits a literal ', and reopens the quote.
    const quotedCwd = `'${cwd.replace(/'/g, "'\\''")}'`
    const quotedCmd = `'${command.replace(/'/g, "'\\''")}'`

    return [
      "docker", "run",
      "--rm",
      "-v", `${quotedCwd}:/workspace`,
      "-w", "/workspace",
      image,
      "sh", "-c",
      quotedCmd,
    ].join(" ")
  }
}
