export * from "./client.js"
export * from "./server.js"

import { createDaxClient } from "./client.js"
import { createDaxServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createDax(options?: ServerOptions) {
  const server = await createDaxServer({
    ...options,
  })

  const client = createDaxClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
