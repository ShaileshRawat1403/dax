import { skillRegistry } from "./registry"
import type { SkillManifest } from "./types"

// In the future, this would read from the filesystem,
// likely from the `packages/dax/src/skills/manifests/` directory.
const dummyManifests: SkillManifest[] = []

/**
 * Loads all skill manifests into the registry.
 */
export function loadSkills() {
  dummyManifests.forEach((manifest) => {
    skillRegistry.register(manifest)
  })
}
