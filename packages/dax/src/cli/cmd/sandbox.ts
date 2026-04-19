import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Sandbox } from "@/shell/sandbox"
import { Flag } from "@/flag/flag"

export const DoctorSandboxCommand = cmd({
  command: "sandbox",
  describe: "inspect sandbox availability and configuration",
  builder: (yargs) =>
    yargs.option("json", {
      describe: "output machine-readable JSON",
      type: "boolean",
      default: false,
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const check = await Sandbox.check()

      if (args.json) {
        process.stdout.write(JSON.stringify(check, null, 2) + "\n")
        return
      }

      UI.empty()
      prompts.intro("Doctor: sandbox")

      if (check.available) {
        prompts.log.success(`Sandbox available: ${check.provider}`)
        if (check.provider === "bwrap") {
          prompts.log.info("Using native Linux bubblewrap sandbox")
        } else if (check.provider === "seatbelt") {
          prompts.log.info("Using macOS Seatbelt sandbox")
        } else if (check.provider === "wsl") {
          prompts.log.info("Using Windows WSL2 sandbox")
        } else if (check.provider === "docker") {
          prompts.log.info("Using Docker fallback sandbox")
        }
      } else {
        prompts.log.warn("Sandbox not available")
        if (check.reason) {
          prompts.log.message(check.reason)
        }

        prompts.log.message("\nTo enable sandbox:")
        prompts.log.message("  1. Install bwrap: apt install bwrap (Linux)")
        prompts.log.message("  2. Install Docker: docker.io (all platforms)")
        prompts.log.message("  3. Or set in dax.yaml:")
        prompts.log.message("     sandbox:")
        prompts.log.message("       enabled: true")
      }

      const envStatus = Flag.DAX_SHELL_SANDBOX_ENABLED
      if (envStatus !== undefined) {
        prompts.log.message(`\nEnvironment override: DAX_SHELL_SANDBOX_ENABLED=${envStatus}`)
      }

      prompts.outro("Done")
    })
  },
})

export const SandboxCommand = cmd({
  command: "sandbox",
  describe: "manage sandbox configuration",
  builder: (yargs) =>
    yargs
      .option("status", {
        describe: "show sandbox status",
        type: "boolean",
        default: false,
      })
      .option("enable", {
        describe: "enable sandbox",
        type: "boolean",
        default: false,
      })
      .option("disable", {
        describe: "disable sandbox",
        type: "boolean",
        default: false,
      })
      .option("json", {
        describe: "output machine-readable JSON",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      if (args.status) {
        const check = await Sandbox.check()
        if (args.json) {
          process.stdout.write(JSON.stringify(check, null, 2) + "\n")
        } else {
          UI.empty()
          prompts.intro("DAX sandbox")

          if (check.available) {
            prompts.log.success(`Available: ${check.provider}`)
          } else {
            prompts.log.warn("Not available")
            if (check.reason) {
              prompts.log.message(check.reason)
            }
          }
        }
        return
      }

      if (args.enable || args.disable) {
        UI.empty()
        prompts.intro("DAX sandbox config")

        const action = args.enable ? "enable" : "disable"
        prompts.log.message(`To ${action} sandbox, add to your dax.yaml:`)

        prompts.log.message(`  sandbox:`)
        prompts.log.message(`    enabled: ${args.enable}`)

        prompts.outro("Restart DAX to apply changes")
        return
      }

      const check = await Sandbox.check()

      UI.empty()
      prompts.intro("DAX sandbox")

      if (check.available) {
        const capability = await Sandbox.getCapability()
        prompts.log.success(`Status: Enabled (${check.provider})`)

        if (capability) {
          prompts.log.message("\nCapabilities:")
          prompts.log.message(`  Filesystem: ${capability.filesystem}`)
          prompts.log.message(`  Network: ${capability.network}`)
          prompts.log.message(`  Process: ${capability.process}`)
        }
      } else {
        prompts.log.warn("Status: Disabled")
        prompts.log.message("\nAvailable providers by platform:")
        prompts.log.message("  Linux: bwrap, landlock")
        prompts.log.message("  macOS: seatbelt (sandbox-exec)")
        prompts.log.message("  Windows: wsl (WSL2 + bwrap)")
        prompts.log.message("\nFallback: docker")

        prompts.log.message("\nTo enable:")
        prompts.log.message("  dax sandbox --enable")
        prompts.log.message("  # Then add to dax.yaml:")
        prompts.log.message("  sandbox:")
        prompts.log.message("    enabled: true")
      }

      prompts.outro("Done")
    })
  },
})
