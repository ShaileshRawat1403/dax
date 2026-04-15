import { Config } from "@/config/config"
import { Flag } from "@/flag/flag"

export namespace Sandbox {
  /**
   * Builds the docker run command string for sandboxed shell execution.
   * Pure function — no I/O, fully testable in isolation.
   */
  export function buildDockerCommand(command: string, cwd: string, image: string): string {
    // Single-quote the sh -c argument; escape any embedded single quotes with '\''.
    const quotedCmd = `'${command.replace(/'/g, "'\\''")}'`

    // The Docker -v flag is parsed by the Docker CLI (not a shell), so we
    // use double-quote escaping for the host bind-mount path.
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

  export async function wrap(command: string, cwd: string): Promise<string> {
    const cfg = await Config.get()
    const enabled = Flag.DAX_SHELL_SANDBOX_ENABLED || cfg.sandbox?.enabled
    if (!enabled) return command

    const provider = cfg.sandbox?.provider ?? "docker"
    if (provider !== "docker") return command

    const image = Flag.DAX_SHELL_SANDBOX_IMAGE ?? cfg.sandbox?.image ?? "node:latest"
    return buildDockerCommand(command, cwd, image)
  }
}
