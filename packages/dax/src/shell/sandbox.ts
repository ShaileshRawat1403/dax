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

    // Quote the host-side bind-mount path separately from the sh -c argument.
    // The Docker -v flag is parsed by the Docker CLI (not a shell), so we
    // use double-quote escaping for the host path, which handles spaces.
    const mountPath = cwd.replace(/"/g, '\\"')

    return [
      "docker", "run",
      "--rm",
      "-v", `"${mountPath}":/workspace:rw`,
      "-w", "/workspace",
      image,
      "sh", "-c",
      quotedCmd,
    ].join(" ")
  }
}
