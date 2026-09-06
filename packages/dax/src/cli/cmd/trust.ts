import type { Argv } from "yargs"
import { EOL } from "os"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Instance } from "../../project/instance"
import * as ProjectTrust from "../../project/trust"
import { Config } from "../../config/config"

function describe(value: ProjectTrust.Executable): string[] {
  const lines: string[] = []
  for (const plugin of value.plugins) lines.push(`  plugin  ${plugin}`)
  for (const server of value.mcp) lines.push(`  mcp     ${server} (spawns a local process)`)
  for (const dir of value.install) lines.push(`  install ${dir} (runs dependency install scripts)`)
  return lines
}

const TrustRevokeCommand = cmd({
  command: "revoke",
  describe: "withdraw trust from this worktree",
  builder: (yargs: Argv) => yargs,
  handler: async () => {
    await bootstrap(process.cwd(), async () => {
      const root = ProjectTrust.root(Instance.worktree, Instance.directory)
      await ProjectTrust.revoke(root)
      process.stdout.write(`Trust revoked for ${root}${EOL}`)
      process.stdout.write(`Its plugins, local MCP servers and install scripts will not run.${EOL}`)
    })
  },
})

export const TrustCommand = cmd({
  command: "trust",
  describe: "review and allow executable configuration declared by this repository",
  builder: (yargs: Argv) =>
    yargs.command(TrustRevokeCommand).option("yes", {
      describe: "grant trust without the confirmation prompt",
      type: "boolean",
      default: false,
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      // Loading config is what populates the withheld set.
      await Config.get()
      const root = ProjectTrust.root(Instance.worktree, Instance.directory)
      const withheld = ProjectTrust.getWithheld()
      const record = await ProjectTrust.status(root)

      if (ProjectTrust.isEmpty(withheld)) {
        if (record) {
          process.stdout.write(`${root} is trusted.${EOL}`)
          return
        }
        process.stdout.write(`${root} declares no executable configuration.${EOL}`)
        process.stdout.write(`Nothing to trust: no plugins, no local MCP servers, no install scripts.${EOL}`)
        return
      }

      process.stdout.write(`${root} declares executable configuration:${EOL}${EOL}`)
      for (const line of describe(withheld)) process.stdout.write(`${line}${EOL}`)
      process.stdout.write(`${EOL}`)
      process.stdout.write(`Trusting this worktree lets the above run with your full access:${EOL}`)
      process.stdout.write(`the filesystem, the network, and every credential in your environment.${EOL}`)
      process.stdout.write(`Only continue if you wrote this code or have read it.${EOL}${EOL}`)

      if (!args.yes) {
        process.stdout.write(`Re-run with --yes to grant trust.${EOL}`)
        return
      }

      const granted = await ProjectTrust.trust(root, withheld)
      process.stdout.write(`Trusted ${root}${EOL}`)
      process.stdout.write(`Digest ${granted.digest.slice(0, 16)} - changing this configuration asks again.${EOL}`)
    })
  },
})
