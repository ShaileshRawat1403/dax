import { InfisicalSDK } from "@infisical/sdk"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"

const log = Log.create({ service: "secrets-loader" })

let cachedSecrets: ResolvedSecrets | null = null
let loadPromise: Promise<ResolvedSecrets> | null = null

export async function getSecrets(): Promise<ResolvedSecrets> {
  if (cachedSecrets) return cachedSecrets
  if (loadPromise) return loadPromise
  loadPromise = loadSecrets().then((secrets) => {
    cachedSecrets = secrets
    return secrets
  })
  return loadPromise
}

/** Clear the process-wide secrets cache. For tests; production loads once and keeps it. */
export function resetSecretsCache(): void {
  cachedSecrets = null
  loadPromise = null
}

export interface SecretEntry {
  secretName: string
  secretValue: string
  secretComment?: string
}

export interface SecretsSource {
  type: "infisical" | "env"
  projectId?: string
  environment?: string
}

class InfisicalClient {
  private sdk: InfisicalSDK | null = null
  private projectId: string | null = null
  private environment: string | null = null
  private initialized = false

  async initialize(): Promise<void> {
    if (this.initialized) return

    const clientId = Flag.INFISICAL_CLIENT_ID
    const clientSecret = Flag.INFISICAL_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      log.info("Infisical not configured - falling back to environment secrets")
      this.initialized = true
      return
    }

    try {
      this.sdk = new InfisicalSDK()
      this.projectId = Flag.INFISICAL_PROJECT_ID ?? null
      this.environment = Flag.INFISICAL_ENVIRONMENT ?? "dev"

      await this.sdk.auth().universalAuth.login({
        clientId,
        clientSecret,
      })

      log.info("Infisical client initialized", {
        projectId: this.projectId,
        environment: this.environment,
        authType: "universal-auth",
      })
    } catch (error) {
      log.warn("failed to initialize Infisical client", {
        error: error instanceof Error ? error.message : String(error),
      })
      this.sdk = null
    }

    this.initialized = true
  }

  async getAll(): Promise<SecretEntry[]> {
    await this.initialize()
    if (!this.sdk) return []

    const projectId = this.projectId ?? ""
    const environment = this.environment ?? "dev"

    if (!projectId) {
      log.warn("Infisical project ID not set - cannot fetch secrets")
      return []
    }

    try {
      const secretsClient = this.sdk.secrets()
      const result = await secretsClient.listSecrets({
        projectId,
        environment,
        includeImports: false,
        viewSecretValue: true,
      })

      return result.secrets.map((secret) => ({
        secretName: secret.secretKey,
        secretValue: secret.secretValue,
        secretComment: secret.secretComment,
      }))
    } catch (error) {
      log.warn("failed to fetch secrets from Infisical", {
        error: error instanceof Error ? error.message : String(error),
        projectId,
        environment,
      })
      return []
    }
  }

  async get(name: string): Promise<string | undefined> {
    await this.initialize()
    if (!this.sdk) return undefined

    const projectId = this.projectId ?? ""
    const environment = this.environment ?? "dev"

    if (!projectId) return undefined

    try {
      const secretsClient = this.sdk.secrets()
      const result = await secretsClient.getSecret({
        secretName: name,
        projectId,
        environment,
        viewSecretValue: true,
      })
      return result.secretValue
    } catch {
      log.debug("secret not found in Infisical", { name, projectId, environment })
      return undefined
    }
  }

  get source(): SecretsSource {
    if (this.sdk) {
      return {
        type: "infisical",
        projectId: this.projectId ?? undefined,
        environment: this.environment ?? undefined,
      }
    }
    return { type: "env" }
  }
}

const infisicalClient = new InfisicalClient()

export interface ResolvedSecrets {
  source: SecretsSource
  substrateToken: string | undefined
  natsCreds: string | undefined
  natsCredsData: Uint8Array | undefined
  serverUsername: string | undefined
  serverPassword: string | undefined
  raw: Map<string, string>
}

async function loadFromFile(path: string): Promise<Uint8Array | undefined> {
  try {
    const data = await Bun.file(path).arrayBuffer()
    return new Uint8Array(data)
  } catch {
    return undefined
  }
}

/**
 * The remote-secrets dependency loadSecrets pulls from. InfisicalClient is the
 * production implementation; tests inject a fake to exercise precedence and
 * field population without a network or the module singleton.
 */
export interface SecretsProvider {
  getAll(): Promise<SecretEntry[]>
  readonly source: SecretsSource
}

export async function loadSecrets(client: SecretsProvider = infisicalClient): Promise<ResolvedSecrets> {
  const infisical = await client.getAll()
  const infisicalMap = new Map<string, string>()
  for (const secret of infisical) {
    infisicalMap.set(secret.secretName, secret.secretValue)
  }

  const substrateToken = infisicalMap.get("DAX_SUBSTRATE_TOKEN") ?? Flag.DAX_SUBSTRATE_TOKEN
  const natsCredsPath = infisicalMap.get("DAX_NATS_CREDS_PATH") ?? Flag.DAX_NATS_CREDS
  const serverUsername = infisicalMap.get("DAX_SERVER_USERNAME") ?? Flag.DAX_SERVER_USERNAME
  const serverPassword = infisicalMap.get("DAX_SERVER_PASSWORD") ?? Flag.DAX_SERVER_PASSWORD

  const natsCredsData = natsCredsPath ? await loadFromFile(natsCredsPath) : undefined

  const raw = new Map<string, string>()
  for (const [name, value] of infisicalMap) {
    raw.set(name, value)
  }

  return {
    source: client.source,
    substrateToken,
    natsCreds: natsCredsPath,
    natsCredsData,
    serverUsername,
    serverPassword,
    raw,
  }
}

export { infisicalClient }
