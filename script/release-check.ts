#!/usr/bin/env bun

import path from "path"
import { existsSync } from "fs"
import fs from "fs/promises"
import { $ } from "bun"

const root = process.cwd()

const requiredFiles = [
  "CHANGELOG.md",
  "packages/dax/script/build.ts",
  "script/install.sh",
  "README.md",
  "docs/product/prerelease.md",
  "docs/product/release-readiness.md",
  "docs/product/contributor-start-here.md",
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

function readRequiredFile(relativePath: string) {
  return fs.readFile(path.join(root, relativePath), "utf8")
}

function expectIncludes(text: string, needle: string, label: string) {
  if (!text.includes(needle)) {
    throw new Error(`${label} is missing required text: ${needle}`)
  }
}

const packageJson = JSON.parse(await readRequiredFile("packages/dax/package.json")) as { version?: string }
const packageVersion = packageJson.version
if (!packageVersion) {
  throw new Error("packages/dax/package.json is missing version")
}

const changelog = await readRequiredFile("CHANGELOG.md")
const unreleasedIndex = changelog.indexOf("## [Unreleased]")
if (unreleasedIndex === -1) {
  throw new Error("CHANGELOG.md must begin with an [Unreleased] section after the header")
}

const releaseHeadings = [...changelog.matchAll(/^## \[(.+?)\] - (\d{4}-\d{2}-\d{2})$/gm)]
if (releaseHeadings.length === 0) {
  throw new Error("CHANGELOG.md must contain at least one tagged release entry")
}

const [latestReleaseMatch] = releaseHeadings
if (latestReleaseMatch.index !== undefined && unreleasedIndex > latestReleaseMatch.index) {
  throw new Error("CHANGELOG.md must place [Unreleased] before the latest tagged release entry")
}

const latestReleaseVersion = latestReleaseMatch[1]
if (latestReleaseVersion !== packageVersion) {
  throw new Error(
    `release version mismatch: packages/dax/package.json=${packageVersion} but latest changelog release=${latestReleaseVersion}`,
  )
}

const readme = await readRequiredFile("README.md")
const docsIndex = await readRequiredFile("docs/README.md")
const doctrine = await readRequiredFile("docs/dax/product-doctrine.md")
const transparency = await readRequiredFile("docs/product/TRANSPARENCY_AND_LIMITATIONS.md")
const prerelease = await readRequiredFile("docs/product/prerelease.md")
const releaseReadiness = await readRequiredFile("docs/product/release-readiness.md")

const forbiddenPhrases = [
  "Deterministic AI eXecution",
  "true deterministic",
  "fully deterministic",
  "truly deterministic",
]

for (const [label, text] of [
  ["README.md", readme],
  ["docs/README.md", docsIndex],
  ["docs/dax/product-doctrine.md", doctrine],
  ["docs/product/TRANSPARENCY_AND_LIMITATIONS.md", transparency],
]) {
  for (const phrase of forbiddenPhrases) {
    if (text.toLowerCase().includes(phrase.toLowerCase())) {
      throw new Error(`${label} contains overstated release-facing language: ${phrase}`)
    }
  }
}

expectIncludes(readme, "deterministic runtime contract around stochastic model execution", "README.md")
expectIncludes(doctrine, "deterministic runtime contract around stochastic model execution", "docs/dax/product-doctrine.md")
expectIncludes(transparency, "provider/auth variability", "docs/product/TRANSPARENCY_AND_LIMITATIONS.md")
expectIncludes(transparency, "probabilistic model outputs", "docs/product/TRANSPARENCY_AND_LIMITATIONS.md")
expectIncludes(transparency, "governance-valid", "docs/product/TRANSPARENCY_AND_LIMITATIONS.md")
expectIncludes(prerelease, "doctor-auth.json", "docs/product/prerelease.md")
expectIncludes(prerelease, "main = next development line", "docs/product/prerelease.md")
expectIncludes(prerelease, "release tag = shipped truth", "docs/product/prerelease.md")
expectIncludes(releaseReadiness, "doctor auth --json", "docs/product/release-readiness.md")
expectIncludes(releaseReadiness, "docs updated later", "docs/product/release-readiness.md")
expectIncludes(releaseReadiness, "tag first, sort truth later", "docs/product/release-readiness.md")

const ghFound = await $`command -v gh`.nothrow()
if (ghFound.exitCode !== 0) {
  console.warn("warning: gh CLI is not installed; release upload will be unavailable")
}

await $`bun run script/check-repo-integrity.ts`

const artifactsDir = path.join(root, "artifacts")
await fs.mkdir(artifactsDir, { recursive: true })
const auditArtifact = path.join(artifactsDir, "audit-result.json")
const authArtifact = path.join(artifactsDir, "doctor-auth.json")

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

const doctorAuthOutput = await $`bun run --cwd packages/dax src/index.ts doctor auth --json`
  .text()
  .catch((error) => {
    throw new Error(
      `failed to generate doctor auth artifact: ${error instanceof Error ? error.message : String(error)}`,
    )
  })

try {
  const start = doctorAuthOutput.indexOf("{")
  const end = doctorAuthOutput.lastIndexOf("}")
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON object found in doctor auth output")
  }
  const parsed = JSON.parse(doctorAuthOutput.slice(start, end + 1))
  await fs.writeFile(authArtifact, JSON.stringify(parsed, null, 2) + "\n", "utf8")
} catch (error) {
  throw new Error(
    `invalid doctor auth JSON output while writing artifact: ${error instanceof Error ? error.message : String(error)}`,
  )
}

console.log(`release-check: wrote ${path.relative(root, authArtifact)}`)

console.log("release-check: ok")
