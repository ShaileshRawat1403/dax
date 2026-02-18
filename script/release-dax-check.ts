#!/usr/bin/env bun

import path from "path"

const roots = ["packages/dax", "packages/plugin", "packages/util"]
const ignore = new Set(["node_modules", "dist", ".git", ".next", ".turbo", "coverage"])
const exts = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".sh",
  ".txt",
  ".yml",
  ".yaml",
  ".toml",
  ".rs",
])

const banned = [
  { id: "pkg-opencode-ai", re: /@opencode-ai\// },
  { id: "repo-opencode", re: /anomalyco\/opencode/ },
  { id: "domain-opencode", re: /\bopencode\.ai\b/ },
  { id: "cmd-opencode", re: /\bopencode\b/ },
]

const allow = [
  /OPENCODE_/,
  /compat/i,
  /deprecat/i,
]

function ok(line: string) {
  return allow.some((re) => re.test(line))
}

async function listEntries(dir: string) {
  try {
    return await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dir, absolute: false }))
  } catch {
    return []
  }
}

async function run() {
  const fail: string[] = []
  const rows = (
    await Promise.all(
      roots.map(async (root) => {
        const paths = await listEntries(root)
        return paths
          .map((rel) => path.join(root, rel))
          .filter((file) => {
            const parts = file.split(path.sep)
            if (parts.some((p) => ignore.has(p))) return false
            return exts.has(path.extname(file))
          })
      }),
    )
  ).flat()

  await Promise.all(
    rows.map(async (file) => {
      const text = await Bun.file(file).text().catch(() => "")
      if (!text) return
      const lines = text.split("\n")
      lines.forEach((line, i) => {
        if (ok(line)) return
        banned.forEach((rule) => {
          if (!rule.re.test(line)) return
          fail.push(`${file}:${i + 1} [${rule.id}] ${line.trim()}`)
        })
      })
    }),
  )

  if (!fail.length) {
    console.log("dax release check: ok")
    return
  }

  console.error("dax release check: failed")
  fail.slice(0, 200).forEach((x) => console.error(x))
  if (fail.length > 200) console.error(`... ${fail.length - 200} more`)
  process.exit(1)
}

await run()
