export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"
export { type Config as DaxClientConfig, type Config as OpencodeClientConfig, OpencodeClient as DaxClient, OpencodeClient }

export function createDaxClient(config?: Config & { directory?: string }) {
  if (!config?.fetch) {
    const customFetch: any = (req: any) => {
      // @ts-ignore
      req.timeout = false
      return fetch(req)
    }
    config = {
      ...config,
      fetch: customFetch,
    }
  }

  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-dax-directory": config.directory,
      "x-opencode-directory": config.directory,
    }
  }

  const client = createClient(config)
  return new OpencodeClient({ client })
}

export const createOpencodeClient = createDaxClient
