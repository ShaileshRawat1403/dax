#!/usr/bin/env bun

import path from "path"
import { existsSync } from "fs"
import { $ } from "bun"

const root = process.cwd()

const requiredFiles = [
  "packages/dax/script/build.ts",
  "script/install.sh",
  "README.md",
  "docs/prerelease.md",
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

console.log("release-check: ok")
