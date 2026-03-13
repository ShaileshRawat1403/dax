import type { SkillManifest } from "./types"

class SkillRegistry {
  private skills: Map<string, SkillManifest> = new Map()

  register(manifest: SkillManifest) {
    if (this.skills.has(manifest.id)) {
      // In the future, we might handle versioning here
      console.warn(`Skill "${manifest.id}" is already registered. Overwriting.`)
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
