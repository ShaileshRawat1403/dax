/** Operator credentials must not be inherited by commands DAX executes.
 * Filter after merging shell.env hooks, including case variants on Windows.
 * This limits direct environment inheritance, not same-user OS access or
 * arbitrary trusted plugin code. Project/provider environment stays usable.
 */
const operatorKeys = new Set([
  "DAX_SERVER_PASSWORD",
  "DAX_SERVER_USERNAME",
  "DAX_SUBSTRATE_TOKEN",
  "DAX_NATS_CREDS",
  "DAX_NATS_CREDS_PATH",
  "DAX_API", // May contain authenticated server URL userinfo.
  "DAX_CONFIG_CONTENT", // May contain inline credentials.
])

export function shellEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => {
      const key = name.toUpperCase()
      return !operatorKeys.has(key) && !key.startsWith("INFISICAL_")
    }),
  )
}
