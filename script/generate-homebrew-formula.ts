#!/usr/bin/env bun
import { mkdir } from "fs/promises"

type CliArgs = {
  version: string
  repo: string
  output: string
}

function parseArgs(argv: string[]): CliArgs {
  const get = (name: string) => {
    const index = argv.indexOf(name)
    if (index === -1) return undefined
    return argv[index + 1]
  }

  const versionRaw = get("--version") ?? process.env.DAX_VERSION
  if (!versionRaw) {
    throw new Error("Missing --version (or DAX_VERSION). Example: --version v1.0.0-beta.6")
  }

  const version = versionRaw.startsWith("v") ? versionRaw : `v${versionRaw}`
  const repo = get("--repo") ?? process.env.DAX_REPO ?? "dax-ai/dax"
  const output = get("--output") ?? "dist/homebrew/Formula/dax.rb"

  return { version, repo, output }
}

type ReleaseManifest = {
  assets: { filename: string; sha256: string }[]
}

function shaFor(manifest: ReleaseManifest, filename: string): string {
  const asset = manifest.assets.find((x) => x.filename === filename)
  if (!asset?.sha256) {
    throw new Error(`Asset checksum missing in manifest: ${filename}`)
  }
  return asset.sha256
}

async function main() {
  const args = parseArgs(Bun.argv)
  const versionNoV = args.version.replace(/^v/, "")
  const baseUrl = `https://github.com/${args.repo}/releases/download/${args.version}`
  const manifestUrl = `${baseUrl}/manifest.json`

  const manifestRes = await fetch(manifestUrl)
  if (!manifestRes.ok) {
    throw new Error(`Failed to fetch manifest: ${manifestUrl} (${manifestRes.status})`)
  }

  const manifest = (await manifestRes.json()) as ReleaseManifest

  const darwinArm = "dax-darwin-arm64.tar.gz"
  const darwinX64 = "dax-darwin-x64.tar.gz"
  const linuxArm = "dax-linux-arm64.tar.gz"
  const linuxX64 = "dax-linux-x64.tar.gz"

  const formula = `class Dax < Formula
  desc "Deterministic AI eXecution CLI"
  homepage "https://github.com/${args.repo}"
  version "${versionNoV}"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "${baseUrl}/${darwinArm}"
      sha256 "${shaFor(manifest, darwinArm)}"
    else
      url "${baseUrl}/${darwinX64}"
      sha256 "${shaFor(manifest, darwinX64)}"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "${baseUrl}/${linuxArm}"
      sha256 "${shaFor(manifest, linuxArm)}"
    else
      url "${baseUrl}/${linuxX64}"
      sha256 "${shaFor(manifest, linuxX64)}"
    end
  end

  def install
    bin.install "dax"
  end

  test do
    output = shell_output("#{bin}/dax --version")
    assert_match version.to_s, output
  end
end
`

  const outputDir = args.output.split("/").slice(0, -1).join("/")
  if (outputDir) {
    await mkdir(outputDir, { recursive: true })
  }
  await Bun.write(args.output, formula)
  console.log(`Generated Homebrew formula: ${args.output}`)
}

await main()
