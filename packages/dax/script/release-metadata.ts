export type ReleaseTarget = {
  os: "darwin" | "linux" | "windows"
  arch: "arm64" | "x64"
  sourceName: string
  archive: "tar.gz" | "zip"
  binary: "dax" | "dax.exe"
}

export const releaseTargets: ReleaseTarget[] = [
  {
    os: "darwin",
    arch: "arm64",
    sourceName: "dax-darwin-arm64",
    archive: "tar.gz",
    binary: "dax",
  },
  {
    os: "darwin",
    arch: "x64",
    sourceName: "dax-darwin-x64",
    archive: "tar.gz",
    binary: "dax",
  },
  {
    os: "darwin",
    arch: "x64",
    sourceName: "dax-darwin-x64-baseline",
    archive: "tar.gz",
    binary: "dax",
  },
  {
    os: "linux",
    arch: "x64",
    sourceName: "dax-linux-x64",
    archive: "tar.gz",
    binary: "dax",
  },
  {
    os: "linux",
    arch: "x64",
    sourceName: "dax-linux-x64-baseline",
    archive: "tar.gz",
    binary: "dax",
  },
  {
    os: "linux",
    arch: "x64",
    sourceName: "dax-linux-x64-musl",
    archive: "tar.gz",
    binary: "dax",
  },
  {
    os: "linux",
    arch: "x64",
    sourceName: "dax-linux-x64-baseline-musl",
    archive: "tar.gz",
    binary: "dax",
  },
  {
    os: "linux",
    arch: "arm64",
    sourceName: "dax-linux-arm64",
    archive: "tar.gz",
    binary: "dax",
  },
  {
    os: "linux",
    arch: "arm64",
    sourceName: "dax-linux-arm64-musl",
    archive: "tar.gz",
    binary: "dax",
  },
  {
    os: "windows",
    arch: "x64",
    sourceName: "dax-windows-x64",
    archive: "zip",
    binary: "dax.exe",
  },
  {
    os: "windows",
    arch: "x64",
    sourceName: "dax-windows-x64-baseline",
    archive: "zip",
    binary: "dax.exe",
  },
]

export function toReleaseTag(version: string) {
  return `v${version}`
}

export function expectedReleaseAssetFilenames() {
  return releaseTargets.map((target) => `${target.sourceName}.${target.archive}`)
}

export function matchesReleaseTagName(tag: string, version: string) {
  return tag === toReleaseTag(version)
}

