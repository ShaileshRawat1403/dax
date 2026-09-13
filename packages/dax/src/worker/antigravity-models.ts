import { z } from "zod"

const MODEL_DISCOVERY_TIMEOUT_MS = 15_000
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000
const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9.-]+$/

export const AntigravityModel = z
  .object({
    id: z.string().min(2).max(128).regex(MODEL_ID_PATTERN),
    name: z.string().min(1).max(160),
  })
  .strict()
export type AntigravityModel = z.infer<typeof AntigravityModel>

export type AntigravityModelsCommand = (
  binary: string,
  timeoutMs: number,
) => Promise<{ exitCode: number; stdout: string; stderr: string; timedOut?: boolean }>

let cached: { binary: string; expiresAt: number; models: AntigravityModel[] } | undefined

export function parseAntigravityModels(output: string): AntigravityModel[] {
  const models: AntigravityModel[] = []
  const seen = new Set<string>()

  for (const rawLine of output.replaceAll("\r\n", "\n").split("\n")) {
    const line = rawLine.trim()
    if (!line || line === "Fetching available models...") continue

    const fields = rawLine.split("\t")
    if (fields.length !== 2) {
      throw new Error(`Antigravity model discovery returned an unrecognized line: ${line.slice(0, 160)}`)
    }
    const model = AntigravityModel.parse({ id: fields[0]?.trim(), name: fields[1]?.trim() })
    if (seen.has(model.id)) {
      throw new Error(`Antigravity model discovery returned duplicate model '${model.id}'.`)
    }
    seen.add(model.id)
    models.push(model)
  }

  if (models.length === 0) {
    throw new Error("Antigravity model discovery returned no models. Authenticate with `agy` and retry.")
  }
  return models
}

async function runModelsCommand(
  binary: string,
  timeoutMs: number,
): ReturnType<AntigravityModelsCommand> {
  const proc = Bun.spawn([binary, "models"], { stdout: "pipe", stderr: "pipe" })
  const stdout = new Response(proc.stdout).text()
  const stderr = new Response(proc.stderr).text()
  let timer: ReturnType<typeof setTimeout> | undefined
  const outcome = await Promise.race([
    proc.exited.then((exitCode) => ({ exitCode, timedOut: false })),
    new Promise<{ exitCode: number; timedOut: true }>((resolve) => {
      timer = setTimeout(() => {
        proc.kill()
        resolve({ exitCode: -1, timedOut: true })
      }, timeoutMs)
    }),
  ])
  if (timer) clearTimeout(timer)
  if (outcome.timedOut) await proc.exited.catch(() => undefined)
  return { ...outcome, stdout: await stdout, stderr: await stderr }
}

function diagnostic(result: { exitCode: number; stderr: string; timedOut?: boolean }): string {
  if (result.timedOut) return "Antigravity model discovery timed out. Check `agy` authentication and connectivity."
  const detail = result.stderr.trim().replaceAll(/\s+/g, " ").slice(0, 500)
  return `Antigravity model discovery failed (exit ${result.exitCode})${detail ? `: ${detail}` : ". Authenticate with `agy` and retry."}`
}

export async function discoverAntigravityModels(options: {
  forceRefresh?: boolean
  timeoutMs?: number
  now?: () => number
  which?: (binary: string) => string | null
  run?: AntigravityModelsCommand
} = {}): Promise<AntigravityModel[]> {
  const now = options.now?.() ?? Date.now()
  const binary = (options.which ?? Bun.which)("agy")
  if (!binary) {
    throw new Error(
      "Antigravity CLI (`agy`) is not installed or is not on PATH. Install it and authenticate once with `agy`.",
    )
  }
  if (!options.forceRefresh && cached?.binary === binary && cached.expiresAt > now) {
    return cached.models.map((model) => ({ ...model }))
  }

  const result = await (options.run ?? runModelsCommand)(binary, options.timeoutMs ?? MODEL_DISCOVERY_TIMEOUT_MS)
  if (result.timedOut || result.exitCode !== 0) throw new Error(diagnostic(result))
  const models = parseAntigravityModels(result.stdout)
  cached = { binary, expiresAt: now + MODEL_CACHE_TTL_MS, models }
  return models.map((model) => ({ ...model }))
}

export function requireAntigravityModel(
  modelId: string | undefined,
  models: readonly AntigravityModel[],
): AntigravityModel {
  if (!modelId?.trim()) {
    throw new Error("Antigravity requires an explicit model. Choose one returned by `agy models`.")
  }
  const selected = models.find((model) => model.id === modelId)
  if (!selected) {
    throw new Error(`Antigravity model '${modelId}' is not available to the authenticated AGY account.`)
  }
  return selected
}

export function resetAntigravityModelCacheForTest(): void {
  cached = undefined
}
