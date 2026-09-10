import { AntigravityModel } from "@/worker/antigravity-models"

export async function fetchAgyModels(fetcher: typeof fetch, url: string) {
  const response = await fetcher(new URL("/runs/agy/models", url))
  const body = await response.json()
  if (!response.ok)
    throw new Error(typeof body.error === "string" ? body.error : "AGY model discovery failed on the execution host.")
  return AntigravityModel.array().parse(body.models)
}
