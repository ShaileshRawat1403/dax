import fs from "fs"
import path from "path"

function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const index = line.indexOf("=")
    if (index <= 0) continue
    const key = line.slice(0, index).trim()
    if (!key) continue
    let value = line.slice(index + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith("`") && value.endsWith("`"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function existingParentDirs(start: string) {
  const result: string[] = []
  let current = path.resolve(start)
  while (true) {
    result.push(current)
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return result.reverse()
}

export function loadEnvHierarchy(startDir: string) {
  const dirs = existingParentDirs(startDir)
  const files = dirs.flatMap((dir) => [path.join(dir, ".env"), path.join(dir, ".env.local")])

  for (const file of files) {
    if (!fs.existsSync(file)) continue
    const parsed = parseDotEnv(fs.readFileSync(file, "utf8"))
    for (const [key, value] of Object.entries(parsed)) {
      // Keep shell-provided variables highest precedence.
      if (process.env[key] !== undefined) continue
      process.env[key] = value
    }
  }
}
