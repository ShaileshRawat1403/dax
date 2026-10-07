import { expect, test } from "bun:test"
import { shellEnvironment } from "./environment"

test("operator environment filtering is case insensitive, immutable and preserves project settings", () => {
  const parent = {
    DAX_SERVER_PASSWORD: "sentinel",
    dax_substrate_token: "sentinel",
    Infisical_CLIENT_SECRET: "sentinel",
    PATH: "project-path",
    OPENAI_API_KEY: "project-provider-sentinel",
    DAX_DISABLE_MODELS_FETCH: "1",
  }
  expect(shellEnvironment(parent)).toEqual({
    PATH: "project-path",
    OPENAI_API_KEY: "project-provider-sentinel",
    DAX_DISABLE_MODELS_FETCH: "1",
  })
  expect(parent.DAX_SERVER_PASSWORD).toBe("sentinel")
})
