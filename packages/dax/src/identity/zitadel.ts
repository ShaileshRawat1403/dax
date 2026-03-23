import * as jose from "jose"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"

const log = Log.create({ service: "zitadel-identity" })

export interface ActorClaims {
  sub: string
  email?: string
  name?: string
  displayName?: string
  orgId?: string
  projectId?: string
  scopes?: string[]
  issuedAt?: Date
  expiresAt?: Date
}

export interface ZitadelConfig {
  domain: string
  issuer: string
  audience: string
}

function buildConfig(): ZitadelConfig | null {
  const domain = Flag.ZITADEL_DOMAIN
  if (!domain) return null

  const baseUrl = domain.replace(/\/$/, "")
  const issuer = Flag.ZITADEL_ISS ?? `${baseUrl}`
  const audience = Flag.ZITADEL_AUD ?? `${baseUrl}/`

  return { domain: baseUrl, issuer, audience }
}

class ZitadelValidator {
  private jwks: jose.JWTVerifyGetKey | null = null
  private initialized = false

  async initialize(): Promise<void> {
    if (this.initialized) return

    const config = buildConfig()
    if (!config) {
      this.initialized = true
      return
    }

    try {
      const jwksUrl = `${config.domain}/.well-known/jwks.json`
      log.info("fetching ZITADEL JWKS", { url: jwksUrl })
      this.jwks = jose.createRemoteJWKSet(new URL(jwksUrl), {
        cacheMaxAge: 5 * 60 * 1000,
      })
      this.initialized = true
      log.info("ZITADEL JWKS initialized", { domain: config.domain })
    } catch (error) {
      log.warn("failed to initialize ZITADEL JWKS", {
        error: error instanceof Error ? error.message : String(error),
      })
      this.initialized = true
    }
  }

  async validateToken(token: string): Promise<ActorClaims | null> {
    await this.initialize()

    const config = buildConfig()
    if (!config || !this.jwks) {
      return null
    }

    try {
      const { payload } = await jose.jwtVerify(token, this.jwks, {
        issuer: config.issuer,
        audience: config.audience,
      })

      return {
        sub: payload.sub ?? "",
        email: payload.email as string | undefined,
        name: payload.name as string | undefined,
        displayName: payload.display_name as string | undefined,
        orgId: payload.org_id as string | undefined,
        projectId: payload.project_id as string | undefined,
        scopes: payload.scope ? (payload.scope as string).split(" ") : undefined,
        issuedAt: payload.iat ? new Date(payload.iat * 1000) : undefined,
        expiresAt: payload.exp ? new Date(payload.exp * 1000) : undefined,
      }
    } catch (error) {
      log.debug("ZITADEL token validation failed", {
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  get isEnabled(): boolean {
    return Boolean(Flag.ZITADEL_DOMAIN)
  }

  get config(): ZitadelConfig | null {
    return buildConfig()
  }
}

export const zitadelValidator = new ZitadelValidator()

export async function validateActorToken(token: string): Promise<ActorClaims | null> {
  if (!Flag.ZITADEL_DOMAIN) return null
  return zitadelValidator.validateToken(token)
}
