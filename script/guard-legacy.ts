#!/usr/bin/env bun

import fs from "fs"
import path from "path"

const root = process.cwd()
const legacyRoots = ["cli", "core", "tui"]
const violations: string[] = []

for (const name of legacyRoots) {
  const target = path.join(root, name)
  if (!fs.existsSync(target)) continue

  const entries = walk(target)
  if (entries.length > 0) {
    violations.push(`${name}/ is a frozen legacy root but still contains files`)
    for (const entry of entries.slice(0, 10)) {
      violations.push(`  - ${path.relative(root, entry)}`)
    }
    if (entries.length > 10) {
      violations.push(`  - ... and ${entries.length - 10} more`)
    }
  }
}

if (violations.length > 0) {
  console.error("guard:legacy: failed")
  for (const violation of violations) console.error(violation)
  process.exit(1)
}

console.log("guard:legacy: ok")

function walk(dir: string): string[] {
  const results: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...walk(full))
    } else {
      results.push(full)
    }
  }
  return results
}
