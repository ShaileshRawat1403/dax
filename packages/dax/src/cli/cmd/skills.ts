import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Skill } from "../../skill/skill"
import { Discovery } from "../../skill/discovery"
import { Config } from "../../config/config"
import { bootstrap } from "../bootstrap"
import { EOL } from "os"

const SkillsListCommand = cmd({
  command: "list",
  describe: "list all available skills",
  async handler() {
    await bootstrap(process.cwd(), async () => {
      const skills = await Skill.all()
      UI.empty()
      prompts.intro("DAX skills")

      for (const skill of skills) {
        prompts.log.info(`${skill.name}: ${skill.description}`)
        prompts.log.message(`  Location: ${skill.location}`)
      }

      prompts.outro("Done")
    })
  },
})

const SkillsSearchCommand = cmd({
  command: "search",
  describe: "search and install skills from the marketplace",
  async handler() {
    await bootstrap(process.cwd(), async () => {
      UI.empty()
      prompts.intro("Skill Marketplace")

      const spinner = prompts.spinner()
      spinner.start("Fetching skill registry...")
      const registry = await Discovery.registry()
      spinner.stop("Fetched registry")

      const selected = await prompts.select({
        message: "Select a skill to install",
        options: registry.map((s) => ({
          label: s.name,
          value: s,
          hint: s.description,
        })),
      })

      if (prompts.isCancel(selected)) throw new UI.CancelledError()
      const skill = selected as Discovery.RegistryEntry

      const config = await Config.getGlobal()
      const urls = new Set(config.skills?.urls ?? [])

      if (urls.has(skill.url)) {
        prompts.log.info(`Skill "${skill.name}" is already installed`)
        return
      }

      urls.add(skill.url)
      await Config.updateGlobal({
        skills: {
          urls: Array.from(urls),
        },
      })

      prompts.log.success(`Successfully installed skill: ${skill.name}`)
      prompts.outro("Restart DAX to load the new skill")
    })
  },
})

export const SkillsCommand = cmd({
  command: "skills",
  describe: "manage skills",
  builder: (yargs) => yargs.command(SkillsListCommand).command(SkillsSearchCommand).demandCommand(),
  async handler() {},
})
