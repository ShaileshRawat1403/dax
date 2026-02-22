import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname } from "node:path"

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

export function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  const raw = readFileSync(path, "utf8")
  if (!raw.trim()) return fallback
  try {
    return JSON.parse(raw) as T
  } catch (e) {
    console.error(`Error parsing JSON from ${path}:`, e)
    return fallback
  }
}

export function writeJson(path: string, value: any): void {
  ensureDir(dirname(path))
  writeFileSync(path, JSON.stringify(value, null, 2))
}
