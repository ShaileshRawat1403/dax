#!/usr/bin/env bun

import path from "path"
import { existsSync } from "fs"
import fs from "fs/promises"
import { $ } from "bun"
import {
  expectedReleaseAssetFilenames,
  matchesReleaseTagName,
  toReleaseTag,
} from "../packages/dax/script/release-metadata"
import { createRustProofReport } from "../packages/dax/src/rust/core"
import { evaluatePolicyWithRust } from "../packages/dax/src/rust/policy"
import { evaluateAuditWithRust } from "../packages/dax/src/rust/audit"

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
  const found = await $`which ${cmd}`.nothrow().quiet()
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
expectIncludes(
  doctrine,
  "deterministic runtime contract around stochastic model execution",
  "docs/dax/product-doctrine.md",
)
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
const headTags = (await gitText(["tag", "--points-at", "HEAD"]))
  .split("\n")
  .map((x) => x.trim())
  .filter(Boolean)
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

  const isStableRelease = !packageVersion.includes("-beta.")
  if (isStableRelease) {
    const prereleaseNote = await readRequiredFile("docs/product/prerelease.md")
    if (prereleaseNote.includes("Stable X.Y.Z releases are marked as latest by default")) {
      console.log("release-check: stable release validation passed - prerelease.md confirms stable releases are latest")
    } else {
      console.warn(
        "WARNING: prerelease.md may not document stable release prerelease flag behavior - review docs/product/prerelease.md",
      )
    }
  }
}

const artifactsDir = path.join(root, "artifacts")
const proofPackDir = path.join(artifactsDir, "proof-pack")
await fs.mkdir(artifactsDir, { recursive: true })
await fs.mkdir(proofPackDir, { recursive: true })
const auditArtifact = path.join(artifactsDir, "audit-result.json")
const authArtifact = path.join(artifactsDir, "doctor-auth.json")
const provenanceArtifact = path.join(artifactsDir, "release-provenance.json")
// kept for backwards compatibility with scripts that reference it by old name
const determinismArtifact = path.join(artifactsDir, "determinism-proof.json")
const replayProofArtifact = path.join(proofPackDir, "replay-proof.json")
const policyProofArtifact = path.join(proofPackDir, "policy-proof.json")
const auditProofArtifact = path.join(proofPackDir, "audit-proof.json")
const proofSummaryArtifact = path.join(proofPackDir, "proof-summary.md")
const releaseCheckHome = path.join(artifactsDir, ".release-check-home")

const determinismFixture = path.join(root, "crates/dax-core/fixtures/basic_completed.events.json")
if (!existsSync(determinismFixture)) {
  throw new Error(`Missing deterministic replay fixture: ${path.relative(root, determinismFixture)}`)
}
await fs.mkdir(releaseCheckHome, { recursive: true })

const daxReleaseEnv = {
  ...process.env,
  DAX_DISABLE_MODELS_FETCH: process.env.DAX_DISABLE_MODELS_FETCH ?? "1",
  DAX_TEST_HOME: process.env.DAX_TEST_HOME ?? releaseCheckHome,
  DAX_DISABLE_CONFIG_AUTO_INSTALL: process.env.DAX_DISABLE_CONFIG_AUTO_INSTALL ?? "1",
}

const auditOutput = await $`bun run --cwd packages/dax src/index.ts audit run --profile strict --json`
  .env(daxReleaseEnv)
  .text()
  .catch((error) => {
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
  throw new Error(
    `invalid audit JSON output while writing artifact: ${error instanceof Error ? error.message : String(error)}`,
  )
}

console.log(`release-check: wrote ${path.relative(root, auditArtifact)}`)

const doctorAuthOutput = await $`bun run --cwd packages/dax src/index.ts doctor auth --json`
  .env(daxReleaseEnv)
  .throws(false)
  .text()

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

// ---------------------------------------------------------------------------
// Proof pack — all three Rust proof surfaces
// ---------------------------------------------------------------------------

// 1. Replay proof (dax-core)
const replayEvents = JSON.parse(await fs.readFile(determinismFixture, "utf8")) as unknown[]
const replayProof = await createRustProofReport(replayEvents).catch((error: unknown) => {
  throw new Error(`failed to generate replay proof: ${error instanceof Error ? error.message : String(error)}`)
})
if (replayProof.schemaVersion !== "dax.core.proof.v1") {
  throw new Error(`unexpected replay proof schemaVersion: ${replayProof.schemaVersion}`)
}
if (replayProof.result !== "pass") {
  throw new Error(`replay proof did not pass: ${JSON.stringify(replayProof)}`)
}
if (typeof replayProof.stateHash !== "string" || !replayProof.stateHash.startsWith("sha256:")) {
  throw new Error("replay proof missing valid stateHash")
}
await fs.writeFile(replayProofArtifact, JSON.stringify(replayProof, null, 2) + "\n", "utf8")
// backwards-compatible alias
await fs.writeFile(determinismArtifact, JSON.stringify(replayProof, null, 2) + "\n", "utf8")
console.log(`release-check: wrote ${path.relative(root, replayProofArtifact)}`)

// 2. Policy proof (dax-policy) — canonical allow/ask/deny snapshot
const policyProofEntries = await Promise.all([
  evaluatePolicyWithRust({
    session_id: "release_check_policy",
    action: { type: "tool_call", tool: "read_file", path: "src/index.ts" },
    context: { profile: "standard" },
  }),
  evaluatePolicyWithRust({
    session_id: "release_check_policy",
    action: { type: "tool_call", tool: "bash", command: "git commit -m 'update'" },
    context: { profile: "standard" },
  }),
  evaluatePolicyWithRust({
    session_id: "release_check_policy",
    action: { type: "tool_call", tool: "bash", command: "rm -rf /tmp/build" },
    context: { profile: "standard", blocklist: ["rm -rf"] },
  }),
]).catch((error: unknown) => {
  throw new Error(`failed to generate policy proof: ${error instanceof Error ? error.message : String(error)}`)
})
for (const entry of policyProofEntries) {
  if (entry.schema_version !== "dax.policy.decision.v1") {
    throw new Error(`unexpected policy proof schemaVersion: ${entry.schema_version}`)
  }
}
const policyProof = {
  schema_version: "dax.policy.proof.v1",
  generated_at: new Date().toISOString(),
  decisions: policyProofEntries,
}
await fs.writeFile(policyProofArtifact, JSON.stringify(policyProof, null, 2) + "\n", "utf8")
console.log(`release-check: wrote ${path.relative(root, policyProofArtifact)}`)

// 3. Audit proof (dax-audit) — clean verified run using the replay fixture
const auditProof = await evaluateAuditWithRust({
  session_id: "release_check_audit",
  events: replayEvents,
  findings: [],
  policy_decision_count: 3,
  override_count: 0,
  audit_present: true,
}).catch((error: unknown) => {
  throw new Error(`failed to generate audit proof: ${error instanceof Error ? error.message : String(error)}`)
})
if (auditProof.schema_version !== "dax.audit.v1") {
  throw new Error(`unexpected audit proof schemaVersion: ${auditProof.schema_version}`)
}
if (auditProof.posture !== "verified") {
  throw new Error(`audit proof posture is not verified: ${auditProof.posture}`)
}
await fs.writeFile(auditProofArtifact, JSON.stringify(auditProof, null, 2) + "\n", "utf8")
console.log(`release-check: wrote ${path.relative(root, auditProofArtifact)}`)

// 4. Proof summary
const policyDecisions = policyProofEntries.map((e) => `${e.decision} (risk: ${e.risk})`).join(", ")
const auditChecks = auditProof.checks.map((c) => `${c.label}: ${c.status}`).join("\n  - ")
const proofSummary = `# DAX Proof Pack

Generated: ${new Date().toISOString()}
Commit: ${gitHeadSha}
Package version: ${packageVersion}

## Replay proof (dax-core)

Schema: ${replayProof.schemaVersion}
Result: ${replayProof.result}
Events: ${replayProof.eventCount}
Final status: ${replayProof.finalStatus ?? "—"}
State hash: ${replayProof.stateHash}
Sequence hash: ${replayProof.eventSequenceHash}

## Policy proof (dax-policy)

Schema: dax.policy.decision.v1
Decisions: ${policyDecisions}

## Audit proof (dax-audit)

Schema: ${auditProof.schema_version}
Posture: ${auditProof.posture}
Verification: ${auditProof.verification_result}
Checks:
  - ${auditChecks}

---

DAX does not make model outputs deterministic.
DAX provides a deterministic runtime contract around stochastic model execution.
`
await fs.writeFile(proofSummaryArtifact, proofSummary, "utf8")
console.log(`release-check: wrote ${path.relative(root, proofSummaryArtifact)}`)

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
    if (releaseMode) {
      throw new Error(
        `release provenance check failed: dist/release manifest version=${manifest.version} does not match package version=${packageVersion}`,
      )
    }

    console.log(
      `release-check: ignoring stale dist/release manifest version=${manifest.version} for non-release package version=${packageVersion}`,
    )
    manifest = undefined
  } else {
    const manifestAssets = (manifest.assets ?? []).map((asset) => asset.filename).filter(Boolean) as string[]
    const missingManifestAssets = expectedArtifactFilenames.filter((filename) => !manifestAssets.includes(filename))
    if (missingManifestAssets.length > 0) {
      throw new Error(
        `release provenance check failed: dist/release manifest is missing expected assets: ${missingManifestAssets.join(", ")}`,
      )
    }
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
  proofs: {
    replay: { path: path.relative(root, replayProofArtifact) },
    policy: { path: path.relative(root, policyProofArtifact) },
    audit: { path: path.relative(root, auditProofArtifact) },
    summary: { path: path.relative(root, proofSummaryArtifact) },
    // backwards-compatible alias
    deterministic_replay: { path: path.relative(root, determinismArtifact) },
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
