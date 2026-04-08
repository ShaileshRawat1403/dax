#!/usr/bin/env bun

import path from "path"
import { existsSync } from "fs"
import fs from "fs/promises"
import { $ } from "bun"
import { expectedReleaseAssetFilenames, matchesReleaseTagName, toReleaseTag } from "../packages/dax/script/release-metadata"

const root = process.cwd()
const releaseMode = process.env.DAX_RELEASE === "1"

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

async function gitText(args: string[]) {
  const proc = Bun.spawn(["git", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) {
    const detail = stderr.trim() || stdout.trim() || `git ${args.join(" ")} exited with code ${exitCode}`
    throw new Error(`git command failed: ${detail}`)
  }
  return stdout.trim()
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
expectIncludes(prerelease, "release-provenance.json", "docs/product/prerelease.md")
expectIncludes(prerelease, "main = next development line", "docs/product/prerelease.md")
expectIncludes(prerelease, "release tag = shipped truth", "docs/product/prerelease.md")
expectIncludes(releaseReadiness, "doctor auth --json", "docs/product/release-readiness.md")
expectIncludes(releaseReadiness, "docs updated later", "docs/product/release-readiness.md")
expectIncludes(releaseReadiness, "tag first, sort truth later", "docs/product/release-readiness.md")
expectIncludes(releaseReadiness, "release-provenance.json", "docs/product/release-readiness.md")

const ghFound = await $`command -v gh`.nothrow()
if (ghFound.exitCode !== 0) {
  console.warn("warning: gh CLI is not installed; release upload will be unavailable")
}

await $`bun run script/check-repo-integrity.ts`

const gitHeadSha = await gitText(["rev-parse", "HEAD"])
const gitBranch = await gitText(["branch", "--show-current"])
const headTags = (await gitText(["tag", "--points-at", "HEAD"])).split("\n").map((x) => x.trim()).filter(Boolean)
const expectedTag = toReleaseTag(packageVersion)

if (releaseMode) {
  const porcelain = await gitText(["status", "--short"])
  if (porcelain.length > 0) {
    throw new Error("release provenance check failed: release mode requires a clean git working tree")
  }
  if (headTags.length === 0) {
    throw new Error(`release provenance check failed: HEAD is not tagged; expected ${expectedTag}`)
  }
  if (!headTags.some((tag) => matchesReleaseTagName(tag, packageVersion))) {
    throw new Error(
      `release provenance check failed: HEAD tags [${headTags.join(", ")}] do not include expected release tag ${expectedTag}`,
    )
  }
}

const artifactsDir = path.join(root, "artifacts")
await fs.mkdir(artifactsDir, { recursive: true })
const auditArtifact = path.join(artifactsDir, "audit-result.json")
const authArtifact = path.join(artifactsDir, "doctor-auth.json")
const provenanceArtifact = path.join(artifactsDir, "release-provenance.json")

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

type ReleaseManifest = {
  version?: string
  generated_at?: string
  assets?: Array<{ filename?: string; platform?: string; arch?: string; sha256?: string }>
}

const expectedArtifactFilenames = expectedReleaseAssetFilenames()
const releaseManifestPath = path.join(root, "packages/dax/dist/release/manifest.json")
let manifest: ReleaseManifest | undefined
if (existsSync(releaseManifestPath)) {
  manifest = JSON.parse(await fs.readFile(releaseManifestPath, "utf8")) as ReleaseManifest
  if (manifest.version && manifest.version !== packageVersion) {
    throw new Error(
      `release provenance check failed: dist/release manifest version=${manifest.version} does not match package version=${packageVersion}`,
    )
  }
  const manifestAssets = (manifest.assets ?? []).map((asset) => asset.filename).filter(Boolean) as string[]
  const missingManifestAssets = expectedArtifactFilenames.filter((filename) => !manifestAssets.includes(filename))
  if (missingManifestAssets.length > 0) {
    throw new Error(
      `release provenance check failed: dist/release manifest is missing expected assets: ${missingManifestAssets.join(", ")}`,
    )
  }
}

const provenance = {
  generated_at: new Date().toISOString(),
  release_mode: releaseMode,
  git: {
    commit: gitHeadSha,
    branch: gitBranch,
    head_tags: headTags,
    expected_tag: expectedTag,
  },
  version: {
    package: packageVersion,
    changelog: latestReleaseVersion,
  },
  artifacts: {
    expected: expectedArtifactFilenames,
    manifest_path: existsSync(releaseManifestPath) ? path.relative(root, releaseManifestPath) : null,
    manifest_version: manifest?.version ?? null,
    manifest_generated_at: manifest?.generated_at ?? null,
    manifest_assets: (manifest?.assets ?? []).map((asset) => ({
      filename: asset.filename ?? null,
      platform: asset.platform ?? null,
      arch: asset.arch ?? null,
      sha256: asset.sha256 ?? null,
    })),
  },
}

await fs.writeFile(provenanceArtifact, JSON.stringify(provenance, null, 2) + "\n", "utf8")
console.log(`release-check: wrote ${path.relative(root, provenanceArtifact)}`)

console.log("release-check: ok")
