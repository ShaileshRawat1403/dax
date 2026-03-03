#!/usr/bin/env bun
import { mkdir } from "fs/promises"

type CliArgs = {
  version: string
  repo: string
  packageIdentifier: string
  outputDir: string
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
  const repo = get("--repo") ?? process.env.DAX_REPO ?? "ShaileshRawat1403/dax-tui"
  const packageIdentifier = get("--id") ?? "ShaileshRawat1403.DAX"
  const outputDir = get("--output-dir") ?? "dist/winget/manifests"
  return { version, repo, packageIdentifier, outputDir }
}

type ReleaseManifest = {
  assets: { filename: string; sha256: string }[]
}

function shaFor(manifest: ReleaseManifest, filename: string): string {
  const asset = manifest.assets.find((x) => x.filename === filename)
  if (!asset?.sha256) {
    throw new Error(`Asset checksum missing in manifest: ${filename}`)
  }
  return asset.sha256.toUpperCase()
}

async function main() {
  const args = parseArgs(Bun.argv)
  const versionNoV = args.version.replace(/^v/, "")
  const installerName = "dax-windows-x64.zip"
  const installerUrl = `https://github.com/${args.repo}/releases/download/${args.version}/${installerName}`
  const manifestUrl = `https://github.com/${args.repo}/releases/download/${args.version}/manifest.json`

  const manifestRes = await fetch(manifestUrl)
  if (!manifestRes.ok) {
    throw new Error(`Failed to fetch manifest: ${manifestUrl} (${manifestRes.status})`)
  }
  const manifest = (await manifestRes.json()) as ReleaseManifest
  const installerSha = shaFor(manifest, installerName)

  const dir = `${args.outputDir}/${versionNoV}`
  const localeFile = `${dir}/${args.packageIdentifier}.locale.en-US.yaml`
  const installerFile = `${dir}/${args.packageIdentifier}.installer.yaml`
  const versionFile = `${dir}/${args.packageIdentifier}.yaml`

  await mkdir(dir, { recursive: true })

  const localeYaml = `PackageIdentifier: ${args.packageIdentifier}
PackageVersion: ${versionNoV}
PackageLocale: en-US
Publisher: Shailesh Rawat
PublisherUrl: https://github.com/${args.repo}
PublisherSupportUrl: https://github.com/${args.repo}/issues
Author: Shailesh Rawat
PackageName: DAX
PackageUrl: https://github.com/${args.repo}
License: MIT
LicenseUrl: https://github.com/${args.repo}/blob/main/LICENSE
ShortDescription: Deterministic AI eXecution CLI
Moniker: dax
ReleaseNotesUrl: https://github.com/${args.repo}/releases/tag/${args.version}
ManifestType: defaultLocale
ManifestVersion: 1.10.0
`

  const installerYaml = `PackageIdentifier: ${args.packageIdentifier}
PackageVersion: ${versionNoV}
InstallerType: zip
NestedInstallerType: portable
NestedInstallerFiles:
  - RelativeFilePath: dax.exe
    PortableCommandAlias: dax
Commands:
  - dax
Installers:
  - Architecture: x64
    InstallerUrl: ${installerUrl}
    InstallerSha256: ${installerSha}
ManifestType: installer
ManifestVersion: 1.10.0
`

  const versionYaml = `PackageIdentifier: ${args.packageIdentifier}
PackageVersion: ${versionNoV}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.10.0
`

  await Bun.write(localeFile, localeYaml)
  await Bun.write(installerFile, installerYaml)
  await Bun.write(versionFile, versionYaml)

  console.log(`Generated winget manifests in: ${dir}`)
  console.log(`Installer URL: ${installerUrl}`)
}

await main()
