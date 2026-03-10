#!/usr/bin/env bun

import { $ } from "bun"

const base = process.argv[2] || process.env.GITHUB_BASE_REF || "origin/main"
const head = process.argv[3] || "HEAD"
const protectedRoots = ["cli/", "core/", "tui/"]

const diff = await $`git diff --name-status ${base}...${head}`.text().catch(async () => {
  return await $`git diff --name-status HEAD~1...HEAD`.text().catch(() => "")
})

const violations = diff
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [status, ...rest] = line.split(/\s+/)
    return { status, file: rest[rest.length - 1] ?? "" }
  })
  .filter(({ status, file }) => status !== "D" && protectedRoots.some((root) => file.startsWith(root)))

if (violations.length > 0) {
  console.error("legacy-boundary: failed")
  for (const item of violations) {
    console.error(`- ${item.status} ${item.file}`)
  }
  console.error("Only deletion/removal work is allowed under root legacy paths: cli/, core/, tui/")
  process.exit(1)
}

console.log("legacy-boundary: ok")
