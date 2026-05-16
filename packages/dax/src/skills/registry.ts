import { Log } from "../util/log"
import type { SkillManifest } from "./types"

const log = Log.create({ service: "skill-registry" })

class SkillRegistry {
  private skills: Map<string, SkillManifest> = new Map()

  register(manifest: SkillManifest) {
    if (this.skills.has(manifest.id)) {
      log.warn("skill already registered, overwriting", { id: manifest.id })
    }
    this.skills.set(manifest.id, manifest)
  }

  get(skillId: string): SkillManifest | undefined {
    return this.skills.get(skillId)
  }

  list(): SkillManifest[] {
    return Array.from(this.skills.values())
  }
}

export const skillRegistry = new SkillRegistry()
