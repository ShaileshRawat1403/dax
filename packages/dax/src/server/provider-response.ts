import type { Provider } from "../provider/provider"

const credentialFields = new Set(["apikey", "headers", "clientsecret", "authorization"])

function redactOptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactOptions)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !credentialFields.has(key.toLowerCase()))
      .map(([key, item]) => [key, redactOptions(item)]),
  )
}

/** Create a public response without mutating credentials used by the provider runtime. */
export function providerResponse(provider: Provider.Info) {
  const { key: _key, ...publicProvider } = provider
  return {
    ...publicProvider,
    options: redactOptions(provider.options),
    models: Object.fromEntries(
      Object.entries(provider.models).map(([id, model]) => [
        id,
        { ...model, headers: {}, options: redactOptions(model.options), variants: redactOptions(model.variants) },
      ]),
    ),
  }
}
