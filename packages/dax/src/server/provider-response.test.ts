import { expect, spyOn, test } from "bun:test"
import { Hono } from "hono"
import { Config } from "../config/config"
import { ModelsDev } from "../provider/models"
import { Provider } from "../provider/provider"
import { ConfigRoutes } from "./routes/config"
import { ProviderRoutes } from "./routes/provider"

test("provider HTTP responses strip credentials without altering runtime configuration", async () => {
  const provider = Provider.fromModelsDevProvider({
    id: "test", name: "Test", env: ["TEST_API_KEY"],
    models: {
      model: {
        id: "model", name: "Model", release_date: "2026-01-01",
        attachment: false, reasoning: false, temperature: false, tool_call: true,
        limit: { context: 1000, output: 100 }, options: { apiKey: "model-secret" },
        headers: { Authorization: "model-header-secret" },
      },
    },
  })
  provider.key = "provider-secret"
  provider.options = {
    apiKey: "options-secret", headers: { Authorization: "header-secret" },
    clientSecret: "client-secret", authorization: "authorization-secret",
    nested: { apiKey: "nested-secret", keep: true }, baseURL: "https://example.test",
  }
  const original = JSON.stringify(provider)
  const mocks = [
    spyOn(Provider, "list").mockResolvedValue({ test: provider }),
    spyOn(Config, "get").mockResolvedValue({}),
    spyOn(ModelsDev, "get").mockResolvedValue({}),
  ]
  try {
    const app = new Hono().route("/config", ConfigRoutes()).route("/provider", ProviderRoutes())
    for (const route of ["/config/providers", "/provider"]) {
      const response = await app.request(route)
      expect(response.status).toBe(200)
      const body = await response.text()
      expect(body).not.toContain("secret")
      expect(body).toContain("https://example.test")
      expect(body).toContain('"keep":true')
      expect(body).not.toContain('"key":')
    }
    expect(JSON.stringify(provider)).toBe(original)
  } finally {
    for (const mock of mocks) mock.mockRestore()
  }
})
