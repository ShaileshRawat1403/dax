#!/usr/bin/env bun

import path from "path"
import { existsSync } from "fs"
import fs from "fs/promises"
import { $ } from "bun"

const root = process.cwd()

const requiredFiles = [
  "packages/dax/script/build.ts",
  "script/install.sh",
  "README.md",
  "docs/prerelease.md",
  "docs/CONTRIBUTOR_START_HERE.md",
  "docs/LEGACY_REMOVAL_PLAN.md",
]

for (const file of requiredFiles) {
  if (!existsSync(path.join(root, file))) {
    throw new Error(`Missing required release file: ${file}`)
  }
}

const requiredCommands = ["bun", "tar", "zip"]
for (const cmd of requiredCommands) {
  const found = await $`command -v ${cmd}`.nothrow()
  if (found.exitCode !== 0) {
    throw new Error(`Missing required command: ${cmd}`)
  }
}

const ghFound = await $`command -v gh`.nothrow()
if (ghFound.exitCode !== 0) {
  console.warn("warning: gh CLI is not installed; release upload will be unavailable")
}

await $`bun run script/check-repo-integrity.ts`

const artifactsDir = path.join(root, "artifacts")
await fs.mkdir(artifactsDir, { recursive: true })
const auditArtifact = path.join(artifactsDir, "audit-result.json")

const auditOutput = await $`bun run --cwd packages/dax src/index.ts audit run --profile strict --json`.text().catch((error) => {
  throw new Error(`failed to generate audit artifact: ${error instanceof Error ? error.message : String(error)}`)
})

try {
  const start = auditOutput.indexOf("{")
  const end = auditOutput.lastIndexOf("}")
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON object found in audit output")
  }
  const parsed = JSON.parse(auditOutput.slice(start, end + 1))
  await fs.writeFile(auditArtifact, JSON.stringify(parsed, null, 2) + "\n", "utf8")
} catch (error) {
  throw new Error(`invalid audit JSON output while writing artifact: ${error instanceof Error ? error.message : String(error)}`)
}

console.log(`release-check: wrote ${path.relative(root, auditArtifact)}`)

console.log("release-check: ok")
