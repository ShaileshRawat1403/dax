import os from "os"
import { DAX_SETTING } from "./settings"

function normalizeName(value?: string | null) {
  if (!value) return undefined
  const trimmed = value.trim().replace(/\s+/g, " ")
  if (!trimmed) return undefined
  return trimmed
}

export function sessionPreferredNameKey(sessionID: string) {
  return `${DAX_SETTING.session_preferred_name_prefix}:${sessionID}`
}

export function resolvePreferredName(input: {
  sessionID?: string
  configUsername?: string
  kvGet: (key: string, defaultValue?: any) => any
}) {
  const sessionName = normalizeName(
    input.sessionID ? input.kvGet(sessionPreferredNameKey(input.sessionID), undefined) : undefined,
  )
  if (sessionName) return sessionName

  const globalName = normalizeName(input.kvGet(DAX_SETTING.preferred_name_default, undefined))
  if (globalName) return globalName

  const configName = normalizeName(input.configUsername)
  if (configName && configName !== os.userInfo().username) return configName

  return undefined
}

export function buildPreferredNamePrompt(name?: string) {
  const normalized = normalizeName(name)
  if (!normalized) return undefined
  return [
    `The user prefers to be addressed as ${normalized}.`,
    "Use the name naturally and sparingly, especially when greeting them, clarifying next steps, or summarizing important findings.",
    "Do not force the name into every paragraph.",
  ].join("\n")
}
