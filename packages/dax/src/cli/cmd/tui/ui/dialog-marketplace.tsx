import { createResource, Show } from "solid-js"
import { useDialog } from "./dialog"
import { DialogSelect } from "./dialog-select"
import { Discovery } from "@/skill/discovery"
import { Config } from "@/config/config"
import { useToast } from "./toast"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"

export function DialogMarketplace() {
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const [registry] = createResource(() => Discovery.registry())

  const onInstall = async (skill: Discovery.RegistryEntry) => {
    const config = await Config.getGlobal()
    const urls = new Set(config.skills?.urls ?? [])
    
    if (urls.has(skill.url)) {
      toast.show({ message: `Skill "${skill.name}" is already installed`, variant: "info" })
      dialog.clear()
      return
    }

    urls.add(skill.url)
    await Config.updateGlobal({
      skills: {
        urls: Array.from(urls),
      },
    })

    toast.show({ message: `Successfully installed skill: ${skill.name}`, variant: "success" })
    dialog.clear()
  }

  return (
    <Show
      when={!registry.loading}
      fallback={
        <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
          <text fg={theme.textMuted}>Fetching skill registry...</text>
        </box>
      }
    >
      <DialogSelect
        title="Skill Marketplace"
        options={(registry() ?? []).map((skill) => ({
          title: skill.name,
          value: skill.url,
          description: skill.description,
          footer: skill.author ? `by ${skill.author}` : undefined,
          onSelect: () => onInstall(skill),
        }))}
        placeholder="Search for a skill..."
      />
    </Show>
  )
}
