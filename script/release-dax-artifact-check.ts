#!/usr/bin/env bun

import path from "path"
import { existsSync } from "fs"

const roots = ["packages/dax/dist", "dist"]
const ignore = new Set(["node_modules", ".git"])
const exts = new Set([".json", ".md", ".txt", ".toml", ".rb", ".yml", ".yaml", ".sh", ".ps1", ".xml"])

const legacy = ["o", "p", "e", "n", "c", "o", "d", "e"].join("")
const banned = [
  { id: "pkg-legacy-ai", re: new RegExp(`@${legacy}-ai/`) },
  { id: "repo-legacy", re: new RegExp(`anomalyco/${legacy}`) },
  { id: "domain-legacy", re: new RegExp(`\\b${legacy}\\.ai\\b`) },
  { id: "name-legacy", re: new RegExp(`\\b${legacy}\\b`) },
]

const allow = [/compat/i, /deprecat/i]

function isAllowed(line: string) {
  return allow.some((re) => re.test(line))
}

async function list(dir: string) {
  return Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dir, absolute: false })).catch(() => [])
}

async function run() {
  const root = roots.find((x) => existsSync(x))
  if (!root) {
    console.error(`dax artifact check: dist not found in any expected path (${roots.join(", ")})`)
    process.exit(1)
  }

  const rows = (await list(root))
    .map((rel) => path.join(root, rel))
    .filter((file) => {
      const parts = file.split(path.sep)
      if (parts.some((x) => ignore.has(x))) return false
      return exts.has(path.extname(file))
    })

  const fail: string[] = []
  await Promise.all(
    rows.map(async (file) => {
      const text = await Bun.file(file).text().catch(() => "")
      if (!text) return
      text.split("\n").forEach((line, i) => {
        if (isAllowed(line)) return
        banned.forEach((rule) => {
          if (!rule.re.test(line)) return
          fail.push(`${file}:${i + 1} [${rule.id}] ${line.trim()}`)
        })
      })
    }),
  )

  if (!fail.length) {
    console.log("dax artifact check: ok")
    return
  }

  console.error("dax artifact check: failed")
  fail.slice(0, 200).forEach((x) => console.error(x))
  if (fail.length > 200) console.error(`... ${fail.length - 200} more`)
  process.exit(1)
}

await run()
