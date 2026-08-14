import type { ExternalWorkerId } from "@/worker/worker-adapter"

/**
 * Egress allowlist authority (C1 network confinement).
 *
 * A governed worker only needs to reach its own provider API. This module is
 * the single source that decides which hosts a worker's egress proxy will let
 * it CONNECT to. It is deliberately pure: it computes host sets and answers
 * yes/no, and knows nothing about sockets. The proxy (egress-proxy.ts) enforces
 * these decisions; the worker_run workflow records what was enforced.
 *
 * Matching is exact host, never wildcard. `api.anthropic.com` is allowed;
 * `evil.api.anthropic.com` is not. Subdomain wildcards would re-open the
 * exfiltration surface this exists to close, so an operator who needs another
 * host states it explicitly (`--allow-egress`).
 *
 * Honesty boundary: this confines a *cooperative* worker — one that honors the
 * injected proxy env. It is not a kernel packet filter. A worker that opens a
 * raw socket and ignores the proxy is not stopped here; closing that residual
 * needs per-host kernel filtering the platform sandboxes cannot express without
 * privilege. The worker_run receipt states which guarantee actually held.
 */

/**
 * Default provider API hosts per worker. Kept minimal: the API endpoint each
 * worker must reach to do its job, plus the auth host where a separate token
 * exchange is unavoidable. Everything else is an explicit operator decision.
 *
 * Custom gateways (a self-hosted proxy, an enterprise relay) are added at
 * runtime from the provider's base-URL env var, so pointing a worker at a
 * private endpoint does not require editing this table.
 */
export const PROVIDER_EGRESS_HOSTS: Record<ExternalWorkerId, readonly string[]> = {
  claude: ["api.anthropic.com"],
  // api.openai.com serves API-key auth; chatgpt.com is the ChatGPT-auth backend
  // (codex opens wss://chatgpt.com/backend-api/codex/responses). Both are the
  // provider, not a third party. Verified live: a ChatGPT-Plus codex run was
  // refused until chatgpt.com was allowlisted.
  codex: ["api.openai.com", "chatgpt.com"],
  gemini: ["generativelanguage.googleapis.com", "oauth2.googleapis.com"],
}

/**
 * Provider env vars that may redirect the worker to a custom API host. When set,
 * the host they name is added to the allowlist so a governed run still reaches an
 * operator-chosen gateway. Only the host is taken; scheme, port, and path are
 * ignored for the allowlist decision (the proxy matches on host).
 */
const PROVIDER_BASE_URL_ENV: Record<ExternalWorkerId, readonly string[]> = {
  claude: ["ANTHROPIC_BASE_URL"],
  codex: ["OPENAI_BASE_URL"],
  gemini: [],
}

/**
 * Reduce any host-ish string to the bare hostname used for allowlist matching.
 * Accepts a bare host, a host:port, or a full URL, and normalizes case and the
 * FQDN trailing dot. Returns "" for input with no usable host — callers treat
 * "" as "never matches" rather than a wildcard.
 *
 * A CONNECT target arrives as "host:port"; a base URL arrives as
 * "https://host/path". Both funnel through here so the allowlist compares like
 * with like.
 */
export function normalizeEgressHost(value: string): string {
  let host = value.trim()
  if (!host) return ""

  // Full URL form: let the URL parser extract the hostname (handles userinfo,
  // ports, IPv6 brackets). Fall through to manual parsing if it is not a URL.
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname
    } catch {
      // not a parseable URL; continue with manual trimming below
    }
  }

  // Drop any path component.
  const slash = host.indexOf("/")
  if (slash !== -1) host = host.slice(0, slash)

  if (host.startsWith("[")) {
    // Bracketed IPv6 literal, optionally with :port after the bracket.
    const end = host.indexOf("]")
    if (end !== -1) host = host.slice(1, end)
  } else {
    // Strip a trailing :port. A hostname never contains ":", so the only colon
    // present is the port separator.
    const colon = host.lastIndexOf(":")
    if (colon !== -1) host = host.slice(0, colon)
  }

  host = host.toLowerCase()
  if (host.endsWith(".")) host = host.slice(0, -1)
  return host
}

/**
 * The set of hosts a worker's egress proxy will permit CONNECT to: the
 * provider defaults, plus any host named by the provider's base-URL env var,
 * plus operator-supplied extras. All normalized; empties dropped.
 */
export function buildEgressAllowlist(input: {
  workerId: ExternalWorkerId
  hostEnv?: Record<string, string | undefined>
  allowHosts?: readonly string[]
}): Set<string> {
  const hosts = new Set<string>()

  const add = (raw: string | undefined) => {
    if (!raw) return
    const normalized = normalizeEgressHost(raw)
    if (normalized) hosts.add(normalized)
  }

  for (const host of PROVIDER_EGRESS_HOSTS[input.workerId]) add(host)
  for (const envName of PROVIDER_BASE_URL_ENV[input.workerId]) add(input.hostEnv?.[envName])
  for (const host of input.allowHosts ?? []) add(host)

  return hosts
}

/**
 * Exact-host membership test. The target (a CONNECT authority like
 * "api.anthropic.com:443") is normalized before comparison, so callers pass the
 * raw request target and get a decision.
 */
export function isEgressHostAllowed(target: string, allowlist: ReadonlySet<string>): boolean {
  const host = normalizeEgressHost(target)
  if (!host) return false
  return allowlist.has(host)
}
