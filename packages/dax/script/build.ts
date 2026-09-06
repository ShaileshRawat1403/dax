#!/usr/bin/env bun

import solidPlugin from "../node_modules/@opentui/solid/scripts/solid-plugin"
import path from "path"
import fs from "fs"
import { $ } from "bun"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")
const snapshotPath = path.join(dir, "src/provider/models-snapshot.ts")

process.chdir(dir)

import pkg from "../package.json"
import { Script } from "@dax-ai/script"
import { releaseTargets, type ReleaseTarget } from "./release-metadata"
import { modelsSnapshotSource } from "./models-snapshot"

const artifactBaseName = pkg.name.includes("/") ? pkg.name.split("/").at(-1)! : pkg.name

const REPO_ROOT = path.resolve(dir, "../..")
const RUST_SIDECAR_BINARIES = ["dax-core", "dax-policy", "dax-audit", "dax-ledger", "dax-indexer"]

const modelsUrl = process.env.DAX_MODELS_URL || "https://models.dev"
let modelsData: string | undefined

if (process.env.MODELS_DEV_API_JSON) {
  modelsData = await Bun.file(process.env.MODELS_DEV_API_JSON).text()
} else {
  try {
    modelsData = await fetch(`${modelsUrl}/api.json`).then((x) => {
      if (!x.ok) throw new Error(`models.dev returned ${x.status}`)
      return x.text()
    })
  } catch (error) {
    if (!fs.existsSync(snapshotPath)) {
      throw new Error(
        `Failed to fetch models.dev snapshot and no checked-in fallback is available: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
    console.warn(
      `build.ts: unable to refresh models snapshot from ${modelsUrl}; using existing ${path.relative(dir, snapshotPath)}`,
    )
  }
}

if (modelsData !== undefined) {
  await Bun.write(snapshotPath, modelsSnapshotSource(modelsData))
  console.log("Generated models-snapshot.ts")
} else {
  console.log("Using existing models-snapshot.ts")
}

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const skipInstall = process.argv.includes("--skip-install")

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "x64", avx2: false },
  { os: "linux", arch: "arm64", abi: "musl" },
  { os: "linux", arch: "x64", abi: "musl" },
  { os: "linux", arch: "x64", abi: "musl", avx2: false },
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "darwin", arch: "x64", avx2: false },
  { os: "win32", arch: "x64" },
  { os: "win32", arch: "x64", avx2: false },
]

const targets = singleFlag
  ? allTargets.filter((item) => {
      if (item.os !== process.platform || item.arch !== process.arch) {
        return false
      }
      if (item.avx2 === false) {
        return baselineFlag
      }
      if (item.abi !== undefined) {
        return false
      }
      return true
    })
  : allTargets

await $`rm -rf dist`

const binaries: Record<string, string> = {}
const pkgDeps = pkg.dependencies as Record<string, string>
const pkgDevDeps = (pkg.devDependencies ?? {}) as Record<string, string>
const watcherVersion = pkgDeps["@parcel/watcher"] ?? pkgDevDeps["@parcel/watcher"]
const parserWorkerPath = path.resolve(dir, "./node_modules/@opentui/core/parser.worker.js")
if (!skipInstall) {
  if (!watcherVersion) {
    throw new Error("Missing @parcel/watcher version in package.json")
  }

  console.log("build.ts: resolving cross-platform OpenTUI and watcher dependencies")
  await $`bun install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`
  await $`bun install --os="*" --cpu="*" @parcel/watcher@${watcherVersion}`
}

function isHostTarget(item: (typeof allTargets)[number]): boolean {
  return (
    item.os === process.platform &&
    item.arch === process.arch &&
    item.abi === undefined &&
    item.avx2 !== false
  )
}

async function buildRustSidecars(targetDirName: string): Promise<void> {
  const ext = process.platform === "win32" ? ".exe" : ""
  console.log(`building Rust sidecars for ${targetDirName}`)
  await $`cargo build --release -p dax-core-bin -p dax-policy-bin -p dax-audit-bin -p dax-ledger-bin -p dax-indexer-bin`.cwd(REPO_ROOT)
  for (const binaryName of RUST_SIDECAR_BINARIES) {
    const src = path.join(REPO_ROOT, "target", "release", `${binaryName}${ext}`)
    const dst = path.join(dir, "dist", targetDirName, "bin", `${binaryName}${ext}`)
    await $`cp ${src} ${dst}`
  }
}

function targetName(item: (typeof allTargets)[number]) {
  return [
    artifactBaseName,
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")
}

async function buildTarget(item: (typeof allTargets)[number]) {
  const name = [
    artifactBaseName,
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")

  console.log(`building ${name}`)
  await $`mkdir -p dist/${name}/bin`

  const parserWorker = fs.realpathSync(parserWorkerPath)
  const workerPath = "./src/cli/cmd/tui/worker.ts"
  const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
  const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")

  await Bun.build({
    conditions: ["browser"],
    tsconfig: "./tsconfig.json",
    plugins: [solidPlugin],
    sourcemap: "external",
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      //@ts-ignore (bun types aren't up to date)
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: name.replace(artifactBaseName, "bun") as any,
      outfile: `dist/${name}/bin/dax`,
      execArgv: [`--user-agent=dax/${Script.version}`, "--use-system-ca", "--"],
      windows: {},
    },
    entrypoints: ["./src/index.ts", parserWorker, workerPath],
    define: {
      DAX_VERSION: `'${Script.version}'`,
      OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
      DAX_WORKER_PATH: workerPath,
      DAX_CHANNEL: `'${Script.channel}'`,
      DAX_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
    },
  })

  await $`rm -rf ./dist/${name}/bin/tui`

  // Sidecars are compiled for the runner's own target only, so every other
  // archive ships without them. Record what a given archive actually contains
  // rather than leaving its absence to be discovered at runtime; building them
  // for every target needs a cross-compilation matrix in the release workflow.
  const sidecars = isHostTarget(item) ? RUST_SIDECAR_BINARIES : []
  if (sidecars.length > 0) {
    await buildRustSidecars(name)
  } else {
    console.warn(`no Rust sidecars for ${name}: not the host target`)
  }

  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: Script.version,
        os: [item.os],
        cpu: [item.arch],
        sidecars,
      },
      null,
      2,
    ),
  )

  binaries[name] = Script.version
}

for (const item of targets) {
  await buildTarget(item)
}

const releaseDir = path.join(dir, "dist", "release")
const shouldPackageReleaseAssets = !singleFlag || process.env.DAX_BUILD_RELEASE_ASSETS === "1"
const releaseAssets: {
  filename: string
  platform: ReleaseTarget["os"]
  arch: ReleaseTarget["arch"]
  sha256: string
}[] = []

if (shouldPackageReleaseAssets) {
  const stagingDir = path.join(releaseDir, ".staging")
  await $`rm -rf ${releaseDir}`
  await $`mkdir -p ${stagingDir}`

  for (const target of releaseTargets) {
    const sourceBinary = path.join(dir, "dist", target.sourceName, "bin", target.binary)
    if (!fs.existsSync(sourceBinary)) {
      const matchingBuildTarget = allTargets.find((item) => targetName(item) === target.sourceName)
      const isCurrentHostTarget =
        matchingBuildTarget &&
        matchingBuildTarget.os === process.platform &&
        matchingBuildTarget.arch === process.arch &&
        matchingBuildTarget.abi === undefined &&
        matchingBuildTarget.avx2 !== false

      if (isCurrentHostTarget) {
        console.warn(`missing ${target.sourceName} during packaging; rebuilding current host target`)
        await buildTarget(matchingBuildTarget)
      }
    }

    if (!fs.existsSync(sourceBinary)) {
      throw new Error(`Missing build output for release asset: ${sourceBinary}`)
    }

    const filename = `${target.sourceName}.${target.archive}`
    const destination = path.join(releaseDir, filename)
    const stagingBinary = path.join(stagingDir, target.binary)

    await $`rm -f ${stagingBinary}`
    await $`cp ${sourceBinary} ${stagingBinary}`

    // Copy any Rust sidecar binaries that were built for this target
    const sidecarExt = target.os === "win32" ? ".exe" : ""
    const presentSidecarNames: string[] = []
    for (const binaryName of RUST_SIDECAR_BINARIES) {
      const sidecarName = `${binaryName}${sidecarExt}`
      const sidecarSrc = path.join(dir, "dist", target.sourceName, "bin", sidecarName)
      if (fs.existsSync(sidecarSrc)) {
        await $`cp ${sidecarSrc} ${path.join(stagingDir, sidecarName)}`
        presentSidecarNames.push(sidecarName)
      }
    }

    if (target.archive === "tar.gz") {
      await $`tar -czf ${destination} -C ${stagingDir} ${[target.binary, ...presentSidecarNames]}`
    } else {
      const allStagingFiles = [stagingBinary, ...presentSidecarNames.map((s) => path.join(stagingDir, s))]
      await $`zip -j -q ${destination} ${allStagingFiles}`
    }

    const hash = new Bun.CryptoHasher("sha256")
    hash.update(await Bun.file(destination).arrayBuffer())

    releaseAssets.push({
      filename,
      platform: target.os,
      arch: target.arch,
      sha256: hash.digest("hex"),
    })
  }

  const installScriptPath = path.resolve(dir, "../../script/install.sh")
  if (fs.existsSync(installScriptPath)) {
    await $`cp ${installScriptPath} ${releaseDir}/install.sh`
  }

  const missingAssets = releaseTargets
    .map((x) => `${artifactBaseName}-${x.os}-${x.arch}.${x.archive}`)
    .filter((filename) => !releaseAssets.some((asset) => asset.filename === filename))
  if (missingAssets.length > 0) {
    throw new Error(`Release assets were not created: ${missingAssets.join(", ")}`)
  }

  await Bun.write(
    path.join(releaseDir, "manifest.json"),
    JSON.stringify(
      {
        version: Script.version,
        generated_at: new Date().toISOString(),
        assets: releaseAssets,
      },
      null,
      2,
    ) + "\n",
  )

  await Bun.write(
    path.join(releaseDir, "SHA256SUMS"),
    releaseAssets.map((asset) => `${asset.sha256}  ${asset.filename}`).join("\n") + "\n",
  )
}

if (Script.release) {
  if (!shouldPackageReleaseAssets) {
    throw new Error("Release publishing requires full assets. Run without --single or set DAX_BUILD_RELEASE_ASSETS=1.")
  }

  if (!/^\d+\.\d+\.\d+(-beta\.\d+)?$/.test(Script.version)) {
    throw new Error(`DAX_VERSION must match X.Y.Z or X.Y.Z-beta.N. Received: ${Script.version}`)
  }

  const tag = `v${Script.version}`
  const title = `DAX ${Script.version}`
  const notes = process.env.DAX_RELEASE_NOTES || `Release ${Script.version}`
  const markDraft = process.env.DAX_RELEASE_DRAFT !== "0"
  // Pre-release defaults to true only for beta versions (X.Y.Z-beta.N).
  // Stable X.Y.Z releases are marked as latest by default so `curl | sh` installers
  // and GitHub's "latest release" API always resolve to the correct artifact.
  // Override with DAX_RELEASE_PRERELEASE=1 to force pre-release on a stable tag.
  const isBeta = Script.version.includes("-beta.")
  const markPrerelease = process.env.DAX_RELEASE_PRERELEASE === "1" || isBeta
  const publishNow = process.env.DAX_RELEASE_PUBLISH === "1"

  const viewResult = await $`gh release view ${tag}`.nothrow()
  if (viewResult.exitCode !== 0) {
    await $`gh release create ${tag} --title ${title} --notes ${notes} ${markDraft ? "--draft" : ""} ${markPrerelease ? "--prerelease" : ""}`
  }

  if (!fs.existsSync(path.join(releaseDir, "install.sh"))) {
    throw new Error("Missing release/install.sh. Create script/install.sh before publishing.")
  }

  await $`gh release upload ${tag} ${releaseDir}/*.tar.gz ${releaseDir}/*.zip ${releaseDir}/manifest.json ${releaseDir}/SHA256SUMS ${releaseDir}/install.sh --clobber`

  if (publishNow) {
    await $`gh release edit ${tag} --draft=false`
  }
}

export { binaries }
