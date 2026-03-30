import { describe, expect, it } from "bun:test"
import path from "path"
import { bootstrap } from "@/cli/bootstrap"
import { Skill } from "./skill"

describe("skill loading", () => {
  const repoRoot = path.resolve(import.meta.dir, "../../../..")
  const packageRoot = path.resolve(import.meta.dir, "../..")

  it("loads the built-in repo skills from the repository root config", async () => {
    const previous = process.env.DAX_DISABLE_EXTERNAL_SKILLS
    process.env.DAX_DISABLE_EXTERNAL_SKILLS = "true"

    try {
      await bootstrap(repoRoot, async () => {
        const skills = await Skill.all()
        const names = skills.map((skill) => skill.name).sort()

        expect(names).toContain("repo-explore")
        expect(names).toContain("git-review")
        expect(names).toContain("release-readiness")
        expect(names).toContain("artifact-audit")
      })
    } finally {
      if (previous === undefined) delete process.env.DAX_DISABLE_EXTERNAL_SKILLS
      else process.env.DAX_DISABLE_EXTERNAL_SKILLS = previous
    }
  })

  it("resolves repo skill paths even when bootstrapped from a nested package directory", async () => {
    const previous = process.env.DAX_DISABLE_EXTERNAL_SKILLS
    process.env.DAX_DISABLE_EXTERNAL_SKILLS = "true"

    try {
      await bootstrap(packageRoot, async () => {
        const skills = await Skill.all()
        const repoExplore = skills.find((skill) => skill.name === "repo-explore")

        expect(repoExplore).toBeDefined()
        expect(repoExplore?.location).toContain("/skills/repo-explore/SKILL.md")
      })
    } finally {
      if (previous === undefined) delete process.env.DAX_DISABLE_EXTERNAL_SKILLS
      else process.env.DAX_DISABLE_EXTERNAL_SKILLS = previous
    }
  })
})
