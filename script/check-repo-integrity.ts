#!/usr/bin/env bun

import fs from "fs"
import path from "path"

const root = process.cwd()

const placeholderChecks = [
  {
    file: "LICENSE",
    pattern: /\(Placeholder for MIT License text\)/,
    message: "LICENSE still contains placeholder text",
  },
  {
    file: "CONTRIBUTING.md",
    pattern: /\(Placeholder for contribution guidelines\)/,
    message: "CONTRIBUTING.md still contains placeholder text",
  },
]

const markdownFiles = walk(root).filter((file) => file.endsWith(".md"))
const problems: string[] = []

for (const check of placeholderChecks) {
  const filepath = path.join(root, check.file)
  const text = fs.readFileSync(filepath, "utf8")
  if (check.pattern.test(text)) problems.push(check.message)
}

for (const file of markdownFiles) {
  const text = fs.readFileSync(file, "utf8")
  const relFile = path.relative(root, file)

  for (const match of text.matchAll(/\[[^\]]+\]\((?!https?:\/\/|mailto:|#)([^)]+)\)/g)) {
    const target = match[1]
    if (!target) continue
    const clean = target.split("#")[0]
    if (!clean || clean.startsWith("file:")) continue
    const resolved = path.resolve(path.dirname(file), clean)
    if (!fs.existsSync(resolved)) {
      problems.push(`${relFile}: missing linked file ${clean}`)
    }
  }

  for (const match of text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1]
    if (!target || target.startsWith("http")) continue
    const clean = target.split("#")[0]
    const resolved = path.resolve(path.dirname(file), clean)
    if (!fs.existsSync(resolved)) {
      problems.push(`${relFile}: missing image asset ${clean}`)
    }
  }
}

if (problems.length > 0) {
  console.error("repo-integrity: failed")
  for (const problem of problems) console.error(`- ${problem}`)
  process.exit(1)
}

console.log("repo-integrity: ok")

function walk(dir: string): string[] {
  const result: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist" || entry.name === "artifacts") {
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...walk(full))
      continue
    }
    result.push(full)
  }
  return result
}
